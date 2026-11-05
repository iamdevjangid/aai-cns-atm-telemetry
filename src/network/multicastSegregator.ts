/**
 * AAI CNS/ATM Radar Telemetry Engine
 * Redundant Dual-Homed Multicast Stream Segregator & Deduplicator
 * 
 * Implements high-reliability zero-loss radar stream ingestion across dual-redundant
 * LAN topologies (Channel A & Channel B), suppressing packet replication and shielding
 * ATC radar display processors from multicast broadcast storms.
 * 
 * @author Dev Jangid <https://github.com/Dev-5678>
 */

export type ChannelId = 'CHANNEL_A' | 'CHANNEL_B';

export interface IngestedDatagram {
  channel: ChannelId;
  radarHeadId: string;
  sequenceNumber: number;
  payload: Buffer;
  receivedTimestampMs: number;
}

export interface ChannelMetrics {
  totalReceived: number;
  duplicatesSuppressed: number;
  outOfOrderCount: number;
  lossDetectedCount: number;
  lastSequenceNumber: number;
  activeThroughputPps: number; // Packets per second
}

export interface SegregatorStats {
  channelA: ChannelMetrics;
  channelB: ChannelMetrics;
  totalUniqueDispatched: number;
  stormThrottledCount: number;
}

export class MulticastSegregator {
  private windowSize: number;
  private maxRatePerSecond: number;
  private processedSequences: Map<string, Set<number>> = new Map();
  private lastProcessedSequence: Map<string, number> = new Map();

  private stats: SegregatorStats = {
    channelA: { totalReceived: 0, duplicatesSuppressed: 0, outOfOrderCount: 0, lossDetectedCount: 0, lastSequenceNumber: 0, activeThroughputPps: 0 },
    channelB: { totalReceived: 0, duplicatesSuppressed: 0, outOfOrderCount: 0, lossDetectedCount: 0, lastSequenceNumber: 0, activeThroughputPps: 0 },
    totalUniqueDispatched: 0,
    stormThrottledCount: 0
  };

  private secondWindowStartMs: number = Date.now();
  private packetsThisSecond: number = 0;

  constructor(windowSize: number = 1000, maxRatePerSecond: number = 50000) {
    this.windowSize = windowSize;
    this.maxRatePerSecond = maxRatePerSecond;
  }

  /**
   * Ingests a datagram from either Channel A or Channel B.
   * Returns the payload if unique and dispatched, or null if duplicate or rate-throttled.
   */
  public ingest(packet: IngestedDatagram): Buffer | null {
    const now = packet.receivedTimestampMs || Date.now();
    const chMetrics = packet.channel === 'CHANNEL_A' ? this.stats.channelA : this.stats.channelB;
    chMetrics.totalReceived++;

    // Leaky bucket rate limiter (Broadcast storm protection)
    if (now - this.secondWindowStartMs > 1000) {
      this.stats.channelA.activeThroughputPps = this.stats.channelA.totalReceived;
      this.stats.channelB.activeThroughputPps = this.stats.channelB.totalReceived;
      this.packetsThisSecond = 0;
      this.secondWindowStartMs = now;
    }

    if (this.packetsThisSecond >= this.maxRatePerSecond) {
      this.stats.stormThrottledCount++;
      return null;
    }

    const radarKey = packet.radarHeadId;
    let seqSet = this.processedSequences.get(radarKey);
    if (!seqSet) {
      seqSet = new Set<number>();
      this.processedSequences.set(radarKey, seqSet);
    }

    // Sequence duplicate check across dual channels
    if (seqSet.has(packet.sequenceNumber)) {
      chMetrics.duplicatesSuppressed++;
      return null; // Duplicate dropped cleanly
    }

    const lastSeq = this.lastProcessedSequence.get(radarKey);
    if (lastSeq !== undefined) {
      const diff = (packet.sequenceNumber - lastSeq) & 0xFFFF;
      if (diff > 0x8000) {
        // Out of order packet
        chMetrics.outOfOrderCount++;
      } else if (diff > 1) {
        // Gap detected: packets were dropped upstream
        chMetrics.lossDetectedCount += (diff - 1);
      }
    }

    // Mark as processed
    seqSet.add(packet.sequenceNumber);
    if (seqSet.size > this.windowSize) {
      // Evict oldest elements to keep window bounded
      const it = seqSet.values();
      for (let i = 0; i < 100; i++) {
        const val = it.next().value;
        if (val !== undefined) seqSet.delete(val);
      }
    }

    this.lastProcessedSequence.set(radarKey, packet.sequenceNumber);
    chMetrics.lastSequenceNumber = packet.sequenceNumber;

    this.packetsThisSecond++;
    this.stats.totalUniqueDispatched++;

    return packet.payload;
  }

  public getStats(): SegregatorStats {
    return {
      channelA: { ...this.stats.channelA },
      channelB: { ...this.stats.channelB },
      totalUniqueDispatched: this.stats.totalUniqueDispatched,
      stormThrottledCount: this.stats.stormThrottledCount
    };
  }

  public resetStats(): void {
    this.stats = {
      channelA: { totalReceived: 0, duplicatesSuppressed: 0, outOfOrderCount: 0, lossDetectedCount: 0, lastSequenceNumber: 0, activeThroughputPps: 0 },
      channelB: { totalReceived: 0, duplicatesSuppressed: 0, outOfOrderCount: 0, lossDetectedCount: 0, lastSequenceNumber: 0, activeThroughputPps: 0 },
      totalUniqueDispatched: 0,
      stormThrottledCount: 0
    };
    this.processedSequences.clear();
    this.lastProcessedSequence.clear();
  }
}
