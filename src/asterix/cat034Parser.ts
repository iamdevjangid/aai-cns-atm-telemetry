/**
 * AAI CNS/ATM Radar Telemetry Engine
 * EUROCONTROL Standard ASTERIX Category 034 Decoder (Radar Service Messages)
 * 
 * Compliant with EUROCONTROL Standard for Surveillance Data Exchange Part 2 (CAT 034 - Ed. 1.27).
 * Used for monitoring radar antenna rotation, synchronization, and operational health.
 * 
 * @author Dev Jangid <https://github.com/Dev-5678>
 */

export interface Cat034ServiceMessage {
  category: number;
  sac: number;
  sic: number;
  messageType: 'NORTH_MARKER' | 'SECTOR_CROSSING' | 'ANTENNA_ROTATION_PERIOD' | 'STATION_STATUS' | 'UNKNOWN';
  timeOfDaySec?: number;
  timeOfDayUtc?: string;
  antennaRotationPeriodSec?: number; // LSB = 1/128 s
  azimuthDeg?: number;               // Sector crossing azimuth
}

export class AsterixCat034Parser {
  public static decodeRecord(buffer: Buffer): Cat034ServiceMessage | null {
    if (buffer.length < 4 || buffer.readUInt8(0) !== 34) {
      return null;
    }

    let offset = 3; // Skip CAT and LEN
    const fspecBits: boolean[] = [];

    while (offset < buffer.length) {
      const byte = buffer.readUInt8(offset++);
      for (let bit = 7; bit >= 1; bit--) {
        fspecBits.push((byte & (1 << bit)) !== 0);
      }
      const hasExtension = (byte & 1) !== 0;
      if (!hasExtension) break;
    }

    let sac = 0;
    let sic = 0;
    let messageType: Cat034ServiceMessage['messageType'] = 'UNKNOWN';
    let timeOfDaySec: number | undefined;
    let timeOfDayUtc: string | undefined;
    let antennaRotationPeriodSec: number | undefined;
    let azimuthDeg: number | undefined;

    // Item 1: I034/010 Data Source Identifier
    if (fspecBits[0] && offset + 2 <= buffer.length) {
      sac = buffer.readUInt8(offset);
      sic = buffer.readUInt8(offset + 1);
      offset += 2;
    }

    // Item 2: I034/020 Message Type
    if (fspecBits[1] && offset < buffer.length) {
      const typeByte = buffer.readUInt8(offset++);
      switch (typeByte) {
        case 1: messageType = 'NORTH_MARKER'; break;
        case 2: messageType = 'SECTOR_CROSSING'; break;
        case 3: messageType = 'ANTENNA_ROTATION_PERIOD'; break;
        case 4: messageType = 'STATION_STATUS'; break;
        default: messageType = 'UNKNOWN';
      }
    }

    // Item 3: I034/030 Time of Day (LSB = 1/128 s)
    if (fspecBits[2] && offset + 3 <= buffer.length) {
      const val = (buffer.readUInt8(offset) << 16) | (buffer.readUInt8(offset + 1) << 8) | buffer.readUInt8(offset + 2);
      timeOfDaySec = val / 128.0;
      const hrs = Math.floor(timeOfDaySec / 3600) % 24;
      const mins = Math.floor((timeOfDaySec % 3600) / 60);
      const secs = (timeOfDaySec % 60).toFixed(2);
      timeOfDayUtc = `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(5, '0')}Z`;
      offset += 3;
    }

    // Item 4: I034/040 Antenna Rotation Period (2 octets, LSB = 1/128 s)
    if (fspecBits[3] && offset + 2 <= buffer.length) {
      const rawPeriod = buffer.readUInt16BE(offset);
      antennaRotationPeriodSec = +(rawPeriod / 128.0).toFixed(3);
      offset += 2;
    }

    // Item 5: I034/050 Sector Number / Azimuth
    if (fspecBits[4] && offset < buffer.length) {
      const rawAzimuth = buffer.readUInt8(offset++);
      azimuthDeg = +((rawAzimuth * 360.0) / 256.0).toFixed(2);
    }

    return {
      category: 34,
      sac,
      sic,
      messageType,
      timeOfDaySec,
      timeOfDayUtc,
      antennaRotationPeriodSec,
      azimuthDeg
    };
  }
}
