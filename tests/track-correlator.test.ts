/**
 * Unit Test Suite for WGS-84 Coordinate Projector & Track Correlator
 * 
 * @author Dev Jangid <https://github.com/Dev-5678>
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { TrackCorrelator, RadarStationConfig } from '../src/telemetry/trackCorrelator.js';
import { AsterixCat048Record } from '../src/asterix/cat048Parser.js';

describe('Radar Telemetry Track Correlator & Airspace Conflict Detection', () => {
  const vidpRadar: RadarStationConfig = {
    name: 'IGI Airport Delhi - Primary Surveillance Radar',
    sac: 30,
    sic: 1,
    latitude: 28.5665,
    longitude: 77.1031,
    elevationMeters: 237
  };

  it('correctly projects polar coordinates to WGS-84 coordinates', () => {
    const correlator = new TrackCorrelator(vidpRadar);
    
    // 60 NM due North (0 degrees)
    const northPt = correlator.projectPolarToWgs84(60.0, 0.0, 10000);
    // 1 degree latitude = approx 60 NM -> latitude should be around 28.5665 + 1.0 = 29.5665
    assert.ok(Math.abs(northPt.latitude - 29.5665) < 0.05, `Expected lat ~29.5665, got ${northPt.latitude}`);
    assert.ok(Math.abs(northPt.longitude - 77.1031) < 0.01, `Expected lon ~77.1031, got ${northPt.longitude}`);
    assert.strictEqual(northPt.altitudeFeet, 10000);
  });

  it('detects loss of standard radar separation between converging aircraft', () => {
    const correlator = new TrackCorrelator(vidpRadar);

    // Aircraft A: Air India 101 at 12 NM Azimuth 090, FL050 (5,000 ft)
    const reportA: AsterixCat048Record = {
      category: 48,
      dataSource: { sac: 30, sic: 1 },
      aircraftCallsign: 'AIC101',
      mode3A: { squawk: '2041', validated: true, garbled: false },
      flightLevel: { flightLevel: 50, altitudeFeet: 5000, validated: true, garbled: false },
      polarPosition: { rhoNm: 12.0, thetaDeg: 90.0 },
      velocity: { groundSpeedKnots: 220, headingDeg: 270 },
      timeOfDaySec: 1000,
      rawBytesLength: 20
    };

    // Aircraft B: IndiGo 204 at 13.5 NM Azimuth 090, FL052 (5,200 ft) -> Distance ~1.5 NM, Alt delta 200 ft -> VIOLATION!
    const reportB: AsterixCat048Record = {
      category: 48,
      dataSource: { sac: 30, sic: 1 },
      aircraftCallsign: 'IGO204',
      mode3A: { squawk: '3152', validated: true, garbled: false },
      flightLevel: { flightLevel: 52, altitudeFeet: 5200, validated: true, garbled: false },
      polarPosition: { rhoNm: 13.5, thetaDeg: 90.0 },
      velocity: { groundSpeedKnots: 210, headingDeg: 270 },
      timeOfDaySec: 1000,
      rawBytesLength: 20
    };

    correlator.updateWithReport(reportA);
    correlator.updateWithReport(reportB);

    assert.strictEqual(correlator.getActiveTrackCount(), 2);

    const conflicts = correlator.detectSeparationConflicts();
    assert.strictEqual(conflicts.length, 1, 'Should trigger 1 airspace separation alert');
    assert.strictEqual(conflicts[0].trackA, 'AIC101');
    assert.strictEqual(conflicts[0].trackB, 'IGO204');
    assert.ok(conflicts[0].horizontalDistanceNm < 2.0);
    assert.strictEqual(conflicts[0].verticalDistanceFeet, 200);
    assert.strictEqual(conflicts[0].severity, 'WARNING');
  });
});
