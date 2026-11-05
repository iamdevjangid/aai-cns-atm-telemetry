/**
 * AAI CNS/ATM Radar Telemetry Engine
 * EUROCONTROL Standard ASTERIX Category 048 Decoder (Monoradar Target Reports)
 * 
 * Compliant with EUROCONTROL Standard for Surveillance Data Exchange Part 4 (CAT 048 - Ed. 1.21).
 * Deployed in Civil Aviation Authority Radar Data Processing Systems (RDPS / ATCAS).
 * 
 * @author Dev Jangid <https://github.com/Dev-5678>
 */

export interface DataSourceIdentifier {
  sac: number; // System Area Code (e.g. 0x1E for India)
  sic: number; // System Identification Code (e.g. 0x01 for VIDP Primary Radar)
}

export interface TargetReportDescriptor {
  typ: 'SSR' | 'PSR' | 'COMBINED' | 'UNKNOWN';
  simulated: boolean;
  rdp: boolean;
  spi: boolean; // Special Position Identification (Squawk Ident)
  rab: boolean; // Aircraft plotted by SSR
}

export interface PolarPosition {
  rhoNm: number;      // Slant range in Nautical Miles (LSB = 1/256 NM)
  thetaDeg: number;   // Azimuth angle in Degrees (0° - 360°, LSB = 360 / 2^16)
}

export interface Mode3ACode {
  squawk: string;     // 4-digit Octal Code (e.g. "7700", "2041")
  validated: boolean;
  garbled: boolean;
}

export interface FlightLevel {
  flightLevel: number; // e.g. FL340 (LSB = 1/4 FL)
  altitudeFeet: number; // FL * 100
  validated: boolean;
  garbled: boolean;
}

export interface CalculatedTrackVelocity {
  groundSpeedKnots: number;  // Ground speed in knots
  headingDeg: number;        // Track angle in degrees (0° - 360°)
}

export interface AsterixCat048Record {
  category: number;
  dataSource: DataSourceIdentifier;
  timeOfDaySec?: number;
  timeOfDayUtc?: string;
  targetDescriptor?: TargetReportDescriptor;
  polarPosition?: PolarPosition;
  mode3A?: Mode3ACode;
  flightLevel?: FlightLevel;
  velocity?: CalculatedTrackVelocity;
  aircraftAddressIcao?: string; // 24-bit Mode S transponder address
  aircraftCallsign?: string;    // Mode S aircraft identification (callsign)
  rawBytesLength: number;
}

export class AsterixCat048Parser {
  /**
   * Decodes a binary buffer containing one or more CAT 048 target report records.
   */
  public static parseDatagram(buffer: Buffer): AsterixCat048Record[] {
    const records: AsterixCat048Record[] = [];
    let offset = 0;

    while (offset < buffer.length) {
      if (offset + 3 > buffer.length) break;

      const category = buffer.readUInt8(offset);
      if (category !== 48) {
        // Not a CAT 048 message
        offset++;
        continue;
      }

      const length = buffer.readUInt16BE(offset + 1);
      if (length < 3 || offset + length > buffer.length) {
        break;
      }

      const recordBuffer = buffer.subarray(offset, offset + length);
      const record = this.decodeRecord(recordBuffer);
      if (record) {
        records.push(record);
      }

      offset += length;
    }

    return records;
  }

  /**
   * Decodes a single CAT 048 record.
   */
  public static decodeRecord(buffer: Buffer): AsterixCat048Record | null {
    if (buffer.length < 4 || buffer.readUInt8(0) !== 48) {
      return null;
    }

    let offset = 3; // Skip CAT (1 byte) and LEN (2 bytes)

    // Parse FSPEC (Field Specification bitmap with Extension bit 0 in LSB)
    const fspecBits: boolean[] = [];
    while (offset < buffer.length) {
      const byte = buffer.readUInt8(offset++);
      for (let bit = 7; bit >= 1; bit--) {
        fspecBits.push((byte & (1 << bit)) !== 0);
      }
      const hasExtension = (byte & 1) !== 0;
      if (!hasExtension) break;
    }

    const record: AsterixCat048Record = {
      category: 48,
      dataSource: { sac: 0, sic: 0 },
      rawBytesLength: buffer.length
    };

    // Item 1: I048/010 Data Source Identifier (SAC/SIC) - 2 octets
    if (fspecBits[0] && offset + 2 <= buffer.length) {
      record.dataSource = {
        sac: buffer.readUInt8(offset),
        sic: buffer.readUInt8(offset + 1)
      };
      offset += 2;
    }

    // Item 2: I048/140 Time-of-Day - 3 octets (LSB = 1/128 s)
    if (fspecBits[1] && offset + 3 <= buffer.length) {
      const b0 = buffer.readUInt8(offset);
      const b1 = buffer.readUInt8(offset + 1);
      const b2 = buffer.readUInt8(offset + 2);
      const val = (b0 << 16) | (b1 << 8) | b2;
      const totalSec = val / 128.0;
      record.timeOfDaySec = totalSec;

      const hrs = Math.floor(totalSec / 3600) % 24;
      const mins = Math.floor((totalSec % 3600) / 60);
      const secs = (totalSec % 60).toFixed(2);
      record.timeOfDayUtc = `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(5, '0')}Z`;
      offset += 3;
    }

    // Item 3: I048/020 Target Report Descriptor - variable length
    if (fspecBits[2] && offset < buffer.length) {
      const firstByte = buffer.readUInt8(offset++);
      const typBits = (firstByte >> 5) & 0x07;
      let typ: TargetReportDescriptor['typ'] = 'UNKNOWN';
      if (typBits === 1) typ = 'PSR';
      else if (typBits === 2) typ = 'SSR';
      else if (typBits === 3) typ = 'COMBINED';

      const sim = (firstByte & (1 << 4)) !== 0;
      const rdp = (firstByte & (1 << 3)) !== 0;
      const spi = (firstByte & (1 << 2)) !== 0;
      const rab = (firstByte & (1 << 1)) !== 0;

      record.targetDescriptor = { typ, simulated: sim, rdp, spi, rab };

      let ext = (firstByte & 1) !== 0;
      while (ext && offset < buffer.length) {
        const extByte = buffer.readUInt8(offset++);
        ext = (extByte & 1) !== 0;
      }
    }

    // Item 4: I048/040 Measured Position in Polar Coordinates (Rho & Theta) - 4 octets
    if (fspecBits[3] && offset + 4 <= buffer.length) {
      const rhoRaw = buffer.readUInt16BE(offset);
      const thetaRaw = buffer.readUInt16BE(offset + 2);
      record.polarPosition = {
        rhoNm: +(rhoRaw / 256.0).toFixed(3),
        thetaDeg: +((thetaRaw * 360.0) / 65536.0).toFixed(3)
      };
      offset += 4;
    }

    // Item 5: I048/070 Mode-3/A Code in Octal Representation - 2 octets
    if (fspecBits[4] && offset + 2 <= buffer.length) {
      const codeWord = buffer.readUInt16BE(offset);
      const validated = (codeWord & 0x8000) === 0;
      const garbled = (codeWord & 0x4000) !== 0;
      const octalVal = codeWord & 0x0FFF;
      const squawk = octalVal.toString(8).padStart(4, '0');

      record.mode3A = { squawk, validated, garbled };
      offset += 2;
    }

    // Item 6: I048/090 Flight Level in Binary Representation - 2 octets (LSB = 1/4 FL)
    if (fspecBits[5] && offset + 2 <= buffer.length) {
      const rawFl = buffer.readUInt16BE(offset);
      const validated = (rawFl & 0x8000) === 0;
      const garbled = (rawFl & 0x4000) !== 0;
      // 14-bit two's complement value
      let flUnits = rawFl & 0x3FFF;
      if (flUnits & 0x2000) {
        flUnits -= 0x4000;
      }
      const flightLevel = +(flUnits / 4.0).toFixed(1);

      record.flightLevel = {
        flightLevel,
        altitudeFeet: Math.round(flightLevel * 100),
        validated,
        garbled
      };
      offset += 2;
    }

    // Item 7: I048/130 Calculated Track Velocity in Polar Representation - 4 octets
    if (fspecBits[6] && offset + 4 <= buffer.length) {
      const rawSpeed = buffer.readUInt16BE(offset);
      const rawHeading = buffer.readUInt16BE(offset + 2);
      // Speed LSB = (2^-14) NM/s approx = 0.22 kt
      const speedKt = +(rawSpeed * (3600.0 / 16384.0)).toFixed(1);
      const headingDeg = +((rawHeading * 360.0) / 65536.0).toFixed(2);

      record.velocity = {
        groundSpeedKnots: speedKt,
        headingDeg
      };
      offset += 4;
    }

    // Check extension fields if present (FSPEC Item 12: I048/220 Aircraft Address 24-bit ICAO)
    if (fspecBits.length > 11 && fspecBits[11] && offset + 3 <= buffer.length) {
      const b0 = buffer.readUInt8(offset).toString(16).padStart(2, '0');
      const b1 = buffer.readUInt8(offset + 1).toString(16).padStart(2, '0');
      const b2 = buffer.readUInt8(offset + 2).toString(16).padStart(2, '0');
      record.aircraftAddressIcao = (b0 + b1 + b2).toUpperCase();
      offset += 3;
    }

    // Item 13: I048/240 Aircraft Identification (Callsign) - 6 octets (8 x 6-bit characters)
    if (fspecBits.length > 12 && fspecBits[12] && offset + 6 <= buffer.length) {
      const chars: string[] = [];
      const SIX_BIT_CHARS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ     0123456789      ';
      let bitAccumulator = 0n;
      for (let i = 0; i < 6; i++) {
        bitAccumulator = (bitAccumulator << 8n) | BigInt(buffer.readUInt8(offset + i));
      }
      for (let i = 7; i >= 0; i--) {
        const charIdx = Number((bitAccumulator >> BigInt(i * 6)) & 0x3Fn);
        chars.push(SIX_BIT_CHARS[charIdx] || ' ');
      }
      record.aircraftCallsign = chars.join('').trim();
      offset += 6;
    }

    return record;
  }
}
