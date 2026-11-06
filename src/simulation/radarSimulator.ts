/**
 * AAI CNS/ATM Radar Telemetry Engine
 * Realistic Radar Stream & Target Report Binary Frame Generator
 * 
 * Simulates Primary and Secondary Surveillance Radar (PSR/MSSR) antenna sweeps,
 * synthesizing binary EUROCONTROL ASTERIX Cat 048 datagrams for Terminal Area
 * Air Traffic Management (ATM) test benches and load simulation.
 * 
 * @author Dev Jangid <https://github.com/iamdevjangid>
 */

export interface SimulatedAircraftProfile {
  callsign: string;
  squawk: string;          // 4-digit octal squawk code (e.g. "2041")
  rhoNm: number;           // Initial slant range in Nautical Miles
  thetaDeg: number;        // Initial azimuth angle (0° - 360°)
  flightLevel: number;     // e.g. 240 for FL240 (24,000 ft)
  groundSpeedKnots: number;// e.g. 280 kt
  headingDeg: number;      // e.g. 270°
  descentRateFpm: number;  // e.g. -1500 fpm
}

export class RadarSimulator {
  private sac: number;
  private sic: number;

  constructor(sac: number = 30 /* India */, sic: number = 1 /* VIDP Delhi */) {
    this.sac = sac;
    this.sic = sic;
  }

  /**
   * Encodes a simulated aircraft state into a standard 22-byte ASTERIX Cat 048 binary buffer.
   */
  public encodeCat048Record(
    aircraft: SimulatedAircraftProfile,
    timeOfDaySec: number = Date.now() / 1000 % 86400
  ): Buffer {
    // Total Length = 22 bytes
    const header = Buffer.from([48, 0, 22]); // CAT 048, Length 22
    const fspec = Buffer.from([0xFE]);       // Items 1 through 7 enabled

    // I048/010: SAC/SIC
    const i010 = Buffer.from([this.sac & 0xFF, this.sic & 0xFF]);

    // I048/140: Time of Day (LSB = 1/128s, 3 octets)
    const timeVal = Math.round(timeOfDaySec * 128) & 0xFFFFFF;
    const i140 = Buffer.from([
      (timeVal >> 16) & 0xFF,
      (timeVal >> 8) & 0xFF,
      timeVal & 0xFF
    ]);

    // I048/020: Target Descriptor (SSR report, RDP processed) -> 0x48
    const i020 = Buffer.from([0x48]);

    // I048/040: Measured Polar Position (Rho: LSB = 1/256 NM, Theta: LSB = 360 / 65536)
    const rhoRaw = Math.min(65535, Math.round(aircraft.rhoNm * 256));
    const thetaRaw = Math.round(((aircraft.thetaDeg % 360) * 65536) / 360) & 0xFFFF;
    const i040 = Buffer.alloc(4);
    i040.writeUInt16BE(rhoRaw, 0);
    i040.writeUInt16BE(thetaRaw, 2);

    // I048/070: Mode 3/A Squawk (4 octal digits)
    const squawkInt = parseInt(aircraft.squawk, 8) & 0x0FFF;
    const i070 = Buffer.alloc(2);
    i070.writeUInt16BE(squawkInt, 0); // bit 15=0 (validated), bit 14=0 (not garbled)

    // I048/090: Flight Level (LSB = 1/4 FL)
    const flUnits = Math.round(aircraft.flightLevel * 4) & 0x3FFF;
    const i090 = Buffer.alloc(2);
    i090.writeUInt16BE(flUnits, 0);

    // I048/130: Velocity (Ground Speed LSB = 0.22 kt, Heading LSB = 360 / 65536)
    const speedRaw = Math.round(aircraft.groundSpeedKnots * (16384 / 3600)) & 0xFFFF;
    const headingRaw = Math.round(((aircraft.headingDeg % 360) * 65536) / 360) & 0xFFFF;
    const i130 = Buffer.alloc(4);
    i130.writeUInt16BE(speedRaw, 0);
    i130.writeUInt16BE(headingRaw, 2);

    return Buffer.concat([header, fspec, i010, i140, i020, i040, i070, i090, i130]);
  }

  /**
   * Advances aircraft position along its heading and descent profile over a delta time in seconds.
   */
  public advanceAircraft(aircraft: SimulatedAircraftProfile, deltaSec: number): SimulatedAircraftProfile {
    // Distance traveled in Nautical Miles: speed (knots = NM/hr) * (deltaSec / 3600)
    const distTraveledNm = aircraft.groundSpeedKnots * (deltaSec / 3600);

    // Convert polar to cartesian delta relative to radar center
    const prevThetaRad = (aircraft.thetaDeg * Math.PI) / 180;
    const currentX = aircraft.rhoNm * Math.sin(prevThetaRad);
    const currentY = aircraft.rhoNm * Math.cos(prevThetaRad);

    const headingRad = (aircraft.headingDeg * Math.PI) / 180;
    const nextX = currentX + distTraveledNm * Math.sin(headingRad);
    const nextY = currentY + distTraveledNm * Math.cos(headingRad);

    const nextRhoNm = +(Math.sqrt(nextX * nextX + nextY * nextY)).toFixed(3);
    let nextThetaDeg = +((Math.atan2(nextX, nextY) * 180) / Math.PI).toFixed(3);
    if (nextThetaDeg < 0) nextThetaDeg += 360;

    // Altitude delta: descentRateFpm * (deltaSec / 60)
    const altDeltaFeet = aircraft.descentRateFpm * (deltaSec / 60);
    const nextFl = Math.max(0, +(aircraft.flightLevel + altDeltaFeet / 100).toFixed(1));

    return {
      ...aircraft,
      rhoNm: nextRhoNm,
      thetaDeg: nextThetaDeg,
      flightLevel: nextFl
    };
  }
}
