/**
 * AAI CNS/ATM Radar Telemetry Engine
 * Geodetic Coordinate Projector & Air Traffic Track Correlator
 * 
 * Transforms radar-relative polar coordinate target reports into WGS-84 geodetic coordinates,
 * performs multi-scan track association, and detects airspace separation conflicts.
 * 
 * @author Dev Jangid <https://github.com/Dev-5678>
 */

import { AsterixCat048Record } from '../asterix/cat048Parser.js';

export interface GeoCoordinate {
  latitude: number;
  longitude: number;
  altitudeFeet: number;
}

export interface RadarStationConfig {
  name: string;
  sac: number;
  sic: number;
  latitude: number;   // Radar antenna latitude in decimal degrees
  longitude: number;  // Radar antenna longitude in decimal degrees
  elevationMeters: number;
}

export interface CorrelatedTrack {
  trackId: string;
  callsign: string;
  squawk: string;
  icao24?: string;
  position: GeoCoordinate;
  groundSpeedKnots: number;
  headingDeg: number;
  verticalRateFpm: number;
  lastUpdatedUtc?: string;
  historyLength: number;
}

export interface SeparationAlert {
  trackA: string;
  trackB: string;
  horizontalDistanceNm: number;
  verticalDistanceFeet: number;
  severity: 'WARNING' | 'CRITICAL';
}

export class TrackCorrelator {
  private station: RadarStationConfig;
  private activeTracks: Map<string, CorrelatedTrack> = new Map();
  private trackHistories: Map<string, Array<{ pos: GeoCoordinate; timeSec: number }>> = new Map();

  // Standard constants
  private static readonly EARTH_RADIUS_NM = 3440.065; // Mean radius in Nautical Miles
  private static readonly NM_TO_METERS = 1852.0;

  constructor(station: RadarStationConfig) {
    this.station = station;
  }

  /**
   * Projects radar polar coordinates (rho in NM, theta in degrees azimuth) to WGS-84 Latitude/Longitude.
   */
  public projectPolarToWgs84(rhoNm: number, thetaDeg: number, altitudeFeet: number = 0): GeoCoordinate {
    const lat1Rad = (this.station.latitude * Math.PI) / 180.0;
    const lon1Rad = (this.station.longitude * Math.PI) / 180.0;
    const bearingRad = (thetaDeg * Math.PI) / 180.0;
    const angularDist = rhoNm / TrackCorrelator.EARTH_RADIUS_NM;

    const lat2Rad = Math.asin(
      Math.sin(lat1Rad) * Math.cos(angularDist) +
      Math.cos(lat1Rad) * Math.sin(angularDist) * Math.cos(bearingRad)
    );

    const lon2Rad = lon1Rad + Math.atan2(
      Math.sin(bearingRad) * Math.sin(angularDist) * Math.cos(lat1Rad),
      Math.cos(angularDist) - Math.sin(lat1Rad) * Math.sin(lat2Rad)
    );

    return {
      latitude: +(lat2Rad * 180.0 / Math.PI).toFixed(6),
      longitude: +(lon2Rad * 180.0 / Math.PI).toFixed(6),
      altitudeFeet
    };
  }

  /**
   * Processes an incoming CAT 048 radar target report and updates track state.
   */
  public updateWithReport(report: AsterixCat048Record): CorrelatedTrack | null {
    if (!report.polarPosition) {
      return null;
    }

    const altitude = report.flightLevel ? report.flightLevel.altitudeFeet : 0;
    const geoPos = this.projectPolarToWgs84(
      report.polarPosition.rhoNm,
      report.polarPosition.thetaDeg,
      altitude
    );

    const trackKey = report.aircraftAddressIcao || report.aircraftCallsign || `SQ_${report.mode3A?.squawk || '0000'}_${report.polarPosition.rhoNm.toFixed(0)}`;
    const nowSec = report.timeOfDaySec || (Date.now() / 1000);

    const history = this.trackHistories.get(trackKey) || [];
    let verticalRateFpm = 0;

    if (history.length > 0) {
      const prev = history[history.length - 1];
      const deltaT = nowSec - prev.timeSec;
      if (deltaT > 0.5) {
        const deltaAlt = altitude - prev.pos.altitudeFeet;
        verticalRateFpm = Math.round((deltaAlt / deltaT) * 60.0);
      }
    }

    history.push({ pos: geoPos, timeSec: nowSec });
    if (history.length > 20) {
      history.shift();
    }
    this.trackHistories.set(trackKey, history);

    const correlated: CorrelatedTrack = {
      trackId: trackKey,
      callsign: report.aircraftCallsign || 'UNASSIGNED',
      squawk: report.mode3A?.squawk || '0000',
      icao24: report.aircraftAddressIcao,
      position: geoPos,
      groundSpeedKnots: report.velocity?.groundSpeedKnots || 0,
      headingDeg: report.velocity?.headingDeg || report.polarPosition.thetaDeg,
      verticalRateFpm,
      lastUpdatedUtc: report.timeOfDayUtc,
      historyLength: history.length
    };

    this.activeTracks.set(trackKey, correlated);
    return correlated;
  }

  /**
   * Calculates Great Circle distance between two coordinates in Nautical Miles.
   */
  public static calculateDistanceNm(pos1: GeoCoordinate, pos2: GeoCoordinate): number {
    const dLat = ((pos2.latitude - pos1.latitude) * Math.PI) / 180.0;
    const dLon = ((pos2.longitude - pos1.longitude) * Math.PI) / 180.0;
    const lat1 = (pos1.latitude * Math.PI) / 180.0;
    const lat2 = (pos2.latitude * Math.PI) / 180.0;

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return +(TrackCorrelator.EARTH_RADIUS_NM * c).toFixed(3);
  }

  /**
   * Scans all active tracks for airspace separation conflicts.
   * Standard Terminal Area Separation: 3.0 NM lateral & 1,000 ft vertical.
   */
  public detectSeparationConflicts(): SeparationAlert[] {
    const alerts: SeparationAlert[] = [];
    const tracks = Array.from(this.activeTracks.values());

    for (let i = 0; i < tracks.length; i++) {
      for (let j = i + 1; j < tracks.length; j++) {
        const t1 = tracks[i];
        const t2 = tracks[j];

        const horizDist = TrackCorrelator.calculateDistanceNm(t1.position, t2.position);
        const vertDist = Math.abs(t1.position.altitudeFeet - t2.position.altitudeFeet);

        if (horizDist < 3.0 && vertDist < 1000) {
          alerts.push({
            trackA: t1.callsign !== 'UNASSIGNED' ? t1.callsign : t1.trackId,
            trackB: t2.callsign !== 'UNASSIGNED' ? t2.callsign : t2.trackId,
            horizontalDistanceNm: horizDist,
            verticalDistanceFeet: vertDist,
            severity: horizDist < 1.5 && vertDist < 500 ? 'CRITICAL' : 'WARNING'
          });
        }
      }
    }

    return alerts;
  }

  public getActiveTrackCount(): number {
    return this.activeTracks.size;
  }

  public getTrack(trackId: string): CorrelatedTrack | undefined {
    return this.activeTracks.get(trackId);
  }
}
