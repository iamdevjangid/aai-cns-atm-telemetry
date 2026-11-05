/**
 * Unit Test Suite for Multicast Segregator & Redundant Channel Deduplication
 * 
 * @author Dev Jangid <https://github.com/Dev-5678>
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { MulticastSegregator } from '../src/network/multicastSegregator.js';

describe('Multicast Stream Segregator & Dual-Homed Deduplicator', () => {
  it('deduplicates simultaneous identical radar frames across Channel A and Channel B', () => {
    const segregator = new MulticastSegregator(100);
    const radarHead = 'VIDP_RADAR_01';
    const payload = Buffer.from([0x30, 0x00, 0x04, 0x80]);

    // Packet sequence 101 arrives on Channel A first
    const dispatchedA = segregator.ingest({
      channel: 'CHANNEL_A',
      radarHeadId: radarHead,
      sequenceNumber: 101,
      payload,
      receivedTimestampMs: 1000
    });
    assert.ok(dispatchedA !== null, 'Channel A frame should be dispatched');

    // Duplicate arrives on Channel B 5ms later
    const dispatchedB = segregator.ingest({
      channel: 'CHANNEL_B',
      radarHeadId: radarHead,
      sequenceNumber: 101,
      payload,
      receivedTimestampMs: 1005
    });
    assert.strictEqual(dispatchedB, null, 'Channel B duplicate must be suppressed');

    const stats = segregator.getStats();
    assert.strictEqual(stats.totalUniqueDispatched, 1);
    assert.strictEqual(stats.channelA.totalReceived, 1);
    assert.strictEqual(stats.channelB.totalReceived, 1);
    assert.strictEqual(stats.channelB.duplicatesSuppressed, 1);
  });

  it('detects packet gaps / upstream loss across sequence window', () => {
    const segregator = new MulticastSegregator(100);
    const radarHead = 'VIDP_RADAR_01';
    const payload = Buffer.from([0x30, 0x00, 0x04, 0x80]);

    // Sequence 10 arrived
    segregator.ingest({ channel: 'CHANNEL_A', radarHeadId: radarHead, sequenceNumber: 10, payload, receivedTimestampMs: 1000 });
    // Sequence 15 arrived (dropped 11, 12, 13, 14 -> gap of 4)
    segregator.ingest({ channel: 'CHANNEL_A', radarHeadId: radarHead, sequenceNumber: 15, payload, receivedTimestampMs: 1050 });

    const stats = segregator.getStats();
    assert.strictEqual(stats.channelA.lossDetectedCount, 4);
  });

  it('enforces broadcast storm rate limiting when ingress exceeds threshold', () => {
    const maxRate = 50;
    const segregator = new MulticastSegregator(500, maxRate);
    const radarHead = 'VIDP_RADAR_01';
    const payload = Buffer.from([0x30, 0x00, 0x04, 0x80]);

    let passed = 0;
    for (let seq = 1; seq <= 100; seq++) {
      const res = segregator.ingest({
        channel: 'CHANNEL_A',
        radarHeadId: radarHead,
        sequenceNumber: seq,
        payload,
        receivedTimestampMs: 2000 // same second
      });
      if (res !== null) passed++;
    }

    assert.strictEqual(passed, maxRate, 'Should cap at exact maxRate per second');
    const stats = segregator.getStats();
    assert.strictEqual(stats.stormThrottledCount, 50, 'Excess frames must be throttled');
  });
});
