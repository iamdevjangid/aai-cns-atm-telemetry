/**
 * AAI CNS/ATM Radar Telemetry Engine
 * Minimum Safe Altitude Warning (MSAW) & Prohibited Airspace Boundary Checker
 * 
 * Evaluates radar target trajectories against Terminal Area minimum vectoring altitudes
 * and restricted/prohibited airspace polygonal perimeters (calibrated for Delhi Terminal Control Area - VIDP).
 * 
 * @author Dev Jangid <https://github.com/iamdevjangid>
 */

import { GeoCoordinate } from './trackCorrelator.js';

export interface AirspacePolygonBoundary {
  name: string;
  designator: string; // e.g. "VID-P45" (Delhi Prohibited Area)
  lowerAltitudeFeet: number;
  upperAltitudeFeet: number;
  coordinates: Array<{ latitude: number; longitude: number }>;
}

export interface TerrainSectorConfig {
  sectorId: string;
  minimumSafeAltitudeFeet: number; // e.g. 3500 ft AMSL within 25 NM of VIDP
  radiusNm: number;
}

export interface MsawWarning {
  callsign: string;
  currentAltitudeFeet: number;
  sectorMsaFeet: number;
  altitudeDeficitFeet: number;
  type: 'TERRAIN_PROXIMITY_WARNING' | 'AIRSPACE_INTRUSION_WARNING';
  targetAirspace?: string;
}

export class AirspaceSectorMonitor {
  private prohibitedAirspaces: AirspacePolygonBoundary[] = [];
  private msaSectors: TerrainSectorConfig[] = [];

  constructor() {
    // Default calibration: Delhi Prohibited Area VID-P45 (Central Secretariat / Rashtrapati Bhavan)
    this.prohibitedAirspaces.push({
      name: 'Delhi VIP Prohibited Airspace',
      designator: 'VID-P45',
      lowerAltitudeFeet: 0,
      upperAltitudeFeet: 45000,
      coordinates: [
        { latitude: 28.6180, longitude: 77.1950 },
        { latitude: 28.6250, longitude: 77.2150 },
        { latitude: 28.6050, longitude: 77.2250 },
        { latitude: 28.5980, longitude: 77.2000 }
      ]
    });

    // Default Terminal Area MSA: 3,500 ft AMSL within 25 NM radius
    this.msaSectors.push({
      sectorId: 'VIDP_TMA_INNER',
      minimumSafeAltitudeFeet: 3500,
      radiusNm: 25.0
    });
  }

  /**
   * Ray-casting algorithm to test whether a coordinate is inside a polygon boundary.
   */
  public isPointInsidePolygon(lat: number, lon: number, polygon: Array<{ latitude: number; longitude: number }>): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].longitude, yi = polygon[i].latitude;
      const xj = polygon[j].longitude, yj = polygon[j].latitude;

      const intersect = ((yi > lat) !== (yj > lat)) &&
        (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  /**
   * Evaluates a radar track coordinate for terrain clearance or prohibited airspace breach.
   */
  public evaluateTrack(callsign: string, pos: GeoCoordinate, slantRangeNm: number): MsawWarning[] {
    const warnings: MsawWarning[] = [];

    // 1. Terrain clearance evaluation (MSAW)
    for (const sector of this.msaSectors) {
      if (slantRangeNm <= sector.radiusNm) {
        if (pos.altitudeFeet < sector.minimumSafeAltitudeFeet) {
          warnings.push({
            callsign,
            currentAltitudeFeet: pos.altitudeFeet,
            sectorMsaFeet: sector.minimumSafeAltitudeFeet,
            altitudeDeficitFeet: sector.minimumSafeAltitudeFeet - pos.altitudeFeet,
            type: 'TERRAIN_PROXIMITY_WARNING'
          });
        }
      }
    }

    // 2. Prohibited Airspace Boundary evaluation
    for (const zone of this.prohibitedAirspaces) {
      if (pos.altitudeFeet >= zone.lowerAltitudeFeet && pos.altitudeFeet <= zone.upperAltitudeFeet) {
        if (this.isPointInsidePolygon(pos.latitude, pos.longitude, zone.coordinates)) {
          warnings.push({
            callsign,
            currentAltitudeFeet: pos.altitudeFeet,
            sectorMsaFeet: zone.lowerAltitudeFeet,
            altitudeDeficitFeet: 0,
            type: 'AIRSPACE_INTRUSION_WARNING',
            targetAirspace: `${zone.designator} (${zone.name})`
          });
        }
      }
    }

    return warnings;
  }
}
