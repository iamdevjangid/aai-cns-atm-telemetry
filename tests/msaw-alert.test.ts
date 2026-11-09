/**
 * Unit Test Suite for Minimum Safe Altitude Warning (MSAW) & Airspace Boundary Monitor
 * 
 * @author Dev Jangid <https://github.com/iamdevjangid>
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AirspaceSectorMonitor } from '../src/telemetry/airspaceSectorAlert.js';
import { GeoCoordinate } from '../src/telemetry/trackCorrelator.js';

describe('MSAW Terrain Safety & Prohibited Airspace Boundary Monitor', () => {
  it('triggers terrain proximity warning when aircraft descends below sector MSA', () => {
    const monitor = new AirspaceSectorMonitor();

    // Aircraft at 15 NM inbound at 2,800 ft (Sector MSA is 3,500 ft) -> 700 ft deficit!
    const position: GeoCoordinate = {
      latitude: 28.5500,
      longitude: 77.0800,
      altitudeFeet: 2800
    };

    const warnings = monitor.evaluateTrack('AIC404', position, 15.0);
    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].type, 'TERRAIN_PROXIMITY_WARNING');
    assert.strictEqual(warnings[0].altitudeDeficitFeet, 700);
  });

  it('triggers airspace intrusion warning when aircraft penetrates prohibited VID-P45 polygon', () => {
    const monitor = new AirspaceSectorMonitor();

    // Inside Rashtrapati Bhavan polygon: Lat ~28.6100, Lon ~77.2100 at 5,000 ft
    const position: GeoCoordinate = {
      latitude: 28.6100,
      longitude: 77.2100,
      altitudeFeet: 5000
    };

    const warnings = monitor.evaluateTrack('VT-TEST', position, 10.0);
    const intrusion = warnings.find(w => w.type === 'AIRSPACE_INTRUSION_WARNING');
    assert.ok(intrusion !== undefined, 'Should detect intrusion into VID-P45');
    assert.ok(intrusion?.targetAirspace?.includes('VID-P45'));
  });

  it('reports zero warnings when aircraft operates within safe limits', () => {
    const monitor = new AirspaceSectorMonitor();

    // Safely at 8,000 ft at 20 NM outside prohibited core
    const position: GeoCoordinate = {
      latitude: 28.4000,
      longitude: 76.9000,
      altitudeFeet: 8000
    };

    const warnings = monitor.evaluateTrack('IGO991', position, 20.0);
    assert.strictEqual(warnings.length, 0);
  });
});
