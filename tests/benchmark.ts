/**
 * Performance Benchmark for ASTERIX Cat 048 Parser & Track Correlator
 * 
 * @author Dev Jangid <https://github.com/Dev-5678>
 */

import { AsterixCat048Parser } from '../src/asterix/cat048Parser.js';
import { TrackCorrelator } from '../src/telemetry/trackCorrelator.js';

console.log('--- AAI CNS/ATM Telemetry Benchmark ---');

// Build 22-byte CAT 048 frame
const header = Buffer.from([0x30, 0x00, 22]);
const fspec = Buffer.from([0xFE]);
const i010 = Buffer.from([0x1E, 0x01]);
const i140 = Buffer.from([0x54, 0x60, 0x00]);
const i020 = Buffer.from([0x48]);
const i040 = Buffer.from([0x19, 0x80, 0x40, 0x00]);
const i070 = Buffer.from([0x0F, 0xC0]);
const i090 = Buffer.from([0x05, 0x50]);
const i130 = Buffer.from([0x07, 0xD2, 0xC0, 0x00]);
const testFrame = Buffer.concat([header, fspec, i010, i140, i020, i040, i070, i090, i130]);

const ITERATIONS = 200000;
const start = performance.now();

for (let i = 0; i < ITERATIONS; i++) {
  AsterixCat048Parser.decodeRecord(testFrame);
}

const elapsedMs = performance.now() - start;
const opsPerSec = Math.round((ITERATIONS / elapsedMs) * 1000);

console.log(`Parsed ${ITERATIONS.toLocaleString()} ASTERIX frames in ${elapsedMs.toFixed(2)}ms`);
console.log(`Throughput: ${opsPerSec.toLocaleString()} frames/second`);

// Correlator Benchmark
const correlator = new TrackCorrelator({
  name: 'VIDP_PRIMARY',
  sac: 30,
  sic: 1,
  latitude: 28.5665,
  longitude: 77.1031,
  elevationMeters: 237
});

const report = AsterixCat048Parser.decodeRecord(testFrame)!;
const startCorr = performance.now();

for (let i = 0; i < ITERATIONS; i++) {
  correlator.projectPolarToWgs84(report.polarPosition!.rhoNm, report.polarPosition!.thetaDeg, 34000);
}

const elapsedCorrMs = performance.now() - startCorr;
const corrOpsPerSec = Math.round((ITERATIONS / elapsedCorrMs) * 1000);

console.log(`Projected ${ITERATIONS.toLocaleString()} polar targets to WGS-84 in ${elapsedCorrMs.toFixed(2)}ms`);
console.log(`Projection Throughput: ${corrOpsPerSec.toLocaleString()} ops/second`);
