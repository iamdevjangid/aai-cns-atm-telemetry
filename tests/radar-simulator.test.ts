/**
 * Unit Test Suite for Radar Simulator & Synthetic Frame Synthesizer
 * 
 * @author Dev Jangid <https://github.com/iamdevjangid>
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { RadarSimulator, SimulatedAircraftProfile } from '../src/simulation/radarSimulator.js';
import { AsterixCat048Parser } from '../src/asterix/cat048Parser.js';

describe('Radar Stream Simulator & Kinematic Trajectory Generator', () => {
  it('synthesizes valid ASTERIX Cat 048 binary frames that roundtrip through parser', () => {
    const simulator = new RadarSimulator(30 /* India */, 1 /* VIDP */);

    const aircraft: SimulatedAircraftProfile = {
      callsign: 'AIC884',
      squawk: '2041',
      rhoNm: 45.25,
      thetaDeg: 270.0,
      flightLevel: 180, // FL180
      groundSpeedKnots: 320,
      headingDeg: 90.0,
      descentRateFpm: -1200
    };

    const binaryFrame = simulator.encodeCat048Record(aircraft, 43200); // 12:00:00 UTC
    assert.strictEqual(binaryFrame.length, 22, 'Encoded ASTERIX Cat 048 frame should be exactly 22 bytes');

    // Roundtrip verification through AsterixCat048Parser
    const decoded = AsterixCat048Parser.decodeRecord(binaryFrame);
    assert.ok(decoded !== null, 'Decoded record must not be null');
    assert.strictEqual(decoded.category, 48);
    assert.strictEqual(decoded.dataSource.sac, 30);
    assert.strictEqual(decoded.dataSource.sic, 1);
    assert.strictEqual(decoded.mode3A?.squawk, '2041');
    assert.strictEqual(decoded.flightLevel?.flightLevel, 180.0);
    assert.strictEqual(decoded.flightLevel?.altitudeFeet, 18000);
    assert.ok(Math.abs((decoded.polarPosition?.rhoNm || 0) - 45.25) < 0.05);
    assert.ok(Math.abs((decoded.polarPosition?.thetaDeg || 0) - 270.0) < 0.1);
  });

  it('accurately advances aircraft kinematics and descent profile across antenna sweeps', () => {
    const simulator = new RadarSimulator(30, 1);

    const initial: SimulatedAircraftProfile = {
      callsign: 'IGO312',
      squawk: '4412',
      rhoNm: 20.0,
      thetaDeg: 0.0,      // Due North of radar
      flightLevel: 100,   // 10,000 ft
      groundSpeedKnots: 180,
      headingDeg: 180.0,  // Flying South straight towards radar antenna
      descentRateFpm: -1500
    };

    // Advance 60 seconds (1 minute): at 180 kt, aircraft travels 3.0 NM South
    const updated = simulator.advanceAircraft(initial, 60);

    // Range should decrease from 20.0 NM to approx 17.0 NM
    assert.ok(Math.abs(updated.rhoNm - 17.0) < 0.1, `Expected range ~17.0 NM, got ${updated.rhoNm}`);
    assert.ok(Math.abs(updated.thetaDeg - 0.0) < 0.1, 'Bearing should remain North while approaching');

    // Altitude should drop by 1500 ft (FL100 -> FL85)
    assert.strictEqual(updated.flightLevel, 85.0);
  });
});
