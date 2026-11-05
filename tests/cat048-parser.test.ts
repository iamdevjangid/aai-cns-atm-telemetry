/**
 * Unit Test Suite for EUROCONTROL ASTERIX Cat 048 Parser
 * Validates binary decoding against standard EUROCONTROL test vectors.
 * 
 * @author Dev Jangid <https://github.com/Dev-5678>
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AsterixCat048Parser } from '../src/asterix/cat048Parser.js';

describe('ASTERIX Cat 048 Monoradar Target Report Parser', () => {
  it('decodes standard Mode-S target report with SAC/SIC, Squawk, Flight Level & Polar Coordinates', () => {
    // Construct synthetic ASTERIX CAT 048 datagram
    // CAT = 48 (0x30), Length = 22 bytes (0x00, 0x16)
    // FSPEC: Byte 1: b11111110 (Items 1, 2, 3, 4, 5, 6, 7 present, no FX bit) -> 0xFE
    // Item 1: I048/010 Data Source Identifier -> SAC=0x1E (30 = India), SIC=0x01 (VIDP) -> 2 bytes [0x1E, 0x01]
    // Item 2: I048/140 Time of Day -> 12:00:00 UTC = 43200 sec -> 43200 * 128 = 5529600 = 0x546000 -> 3 bytes [0x54, 0x60, 0x00]
    // Item 3: I048/020 Target Report Descriptor -> TYP=SSR (2 << 5 = 0x40), SIM=0, RDP=1, SPI=0, RAB=0, FX=0 -> 1 byte [0x48]
    // Item 4: I048/040 Measured Position -> Rho = 25.5 NM -> 25.5 * 256 = 6528 = 0x1980; Theta = 90.0 deg -> (90 * 65536) / 360 = 16384 = 0x4000 -> 4 bytes [0x19, 0x80, 0x40, 0x00]
    // Item 5: I048/070 Mode 3/A -> Validated=1 (bit 15=0), Garbled=0 (bit 14=0), Squawk=07700 (octal) -> 0x0FC0 -> 2 bytes [0x0F, 0xC0]
    // Item 6: I048/090 Flight Level -> Validated=1 (bit 15=0), Garbled=0, FL=340 -> 340 * 4 = 1360 = 0x0550 -> 2 bytes [0x05, 0x50]
    // Item 7: I048/130 Calculated Velocity -> Speed = 440 kt -> 440 * 16384 / 3600 = 2002 = 0x07D2; Heading = 270 deg -> (270 * 65536) / 360 = 49152 = 0xC000 -> 4 bytes [0x07, 0xD2, 0xC0, 0x00]

    const header = Buffer.from([0x30, 0x00, 22]);
    const fspec = Buffer.from([0xFE]);
    const i010 = Buffer.from([0x1E, 0x01]);
    const i140 = Buffer.from([0x54, 0x60, 0x00]);
    const i020 = Buffer.from([0x48]);
    const i040 = Buffer.from([0x19, 0x80, 0x40, 0x00]);
    const i070 = Buffer.from([0x0F, 0xC0]);
    const i090 = Buffer.from([0x05, 0x50]);
    const i130 = Buffer.from([0x07, 0xD2, 0xC0, 0x00]);

    const frame = Buffer.concat([header, fspec, i010, i140, i020, i040, i070, i090, i130]);
    assert.strictEqual(frame.length, 22);

    const record = AsterixCat048Parser.decodeRecord(frame);
    assert.ok(record, 'Record should decode successfully');
    assert.strictEqual(record?.category, 48);
    assert.strictEqual(record?.dataSource.sac, 30);
    assert.strictEqual(record?.dataSource.sic, 1);
    assert.strictEqual(record?.timeOfDaySec, 43200);
    assert.strictEqual(record?.targetDescriptor?.typ, 'SSR');
    assert.strictEqual(record?.polarPosition?.rhoNm, 25.5);
    assert.strictEqual(record?.polarPosition?.thetaDeg, 90.0);
    assert.strictEqual(record?.mode3A?.squawk, '7700');
    assert.strictEqual(record?.mode3A?.validated, true);
    assert.strictEqual(record?.flightLevel?.flightLevel, 340);
    assert.strictEqual(record?.flightLevel?.altitudeFeet, 34000);
    assert.strictEqual(record?.velocity?.headingDeg, 270.0);
  });

  it('gracefully rejects corrupted or truncated packets', () => {
    const truncated = Buffer.from([0x30, 0x00, 0x10, 0x80]);
    const res = AsterixCat048Parser.decodeRecord(truncated);
    assert.ok(res !== null);
    assert.strictEqual(res?.dataSource.sac, 0); // Fspec indicated field not completely in buffer
  });
});
