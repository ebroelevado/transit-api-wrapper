import { ensureLineIndex } from '../sources/lineIndex';
import { resolveStop, timeToMinutes, currentTimeStr } from '../utils/helpers';
import { findOptimalRoute, OptimalTripOption } from './transitGraph';
import logger from '../utils/logger';

// Legacy format backward compatibility wrapper
export async function buildTripOptions(fromStopId: number, toStopId: number): Promise<OptimalTripOption[]> {
  await ensureLineIndex();

  const fromStop = await resolveStop(fromStopId);
  const toStop = await resolveStop(toStopId);

  const fromCoords = fromStop ? { lat: fromStop.lat, lng: fromStop.lng } : undefined;
  const toCoords = toStop ? { lat: toStop.lat, lng: toStop.lng } : undefined;

  const nowMinutes = timeToMinutes(currentTimeStr());
  // For simplicity, assuming 'weekday'. In a complete implementation, this should be deduced from the Date.
  const dayType = 'weekday'; 

  const optimalRoute = findOptimalRoute(fromStopId, toStopId, fromCoords, toCoords, nowMinutes, dayType);

  if (!optimalRoute) {
    logger.debug(`[trip.service] No route found between ${fromStopId} and ${toStopId}`);
    return [];
  }

  // Populate missing names that weren't in stopCoordsCache
  for (const leg of optimalRoute.legs) {
    if (!leg.from_stop.name) {
      const s = await resolveStop(leg.from_stop.stopId);
      leg.from_stop.name = s?.name || `Parada ${leg.from_stop.stopId}`;
    }
    if (!leg.to_stop.name) {
      const s = await resolveStop(leg.to_stop.stopId);
      leg.to_stop.name = s?.name || `Parada ${leg.to_stop.stopId}`;
    }
  }

  return [optimalRoute];
}

export interface ConnectionEntry {
  stopId: number;
  name: string;
  lat: number;
  lng: number;
  lines: string[];
}

export async function buildConnections(stopId: number): Promise<ConnectionEntry[]> {
  await ensureLineIndex();
  
  const stop = await resolveStop(stopId);
  if (!stop) return [];

  const { getLines, getLinesForStop } = await import('../sources/lineIndex');
  
  const catalog = getLines();
  
  const directLines = getLinesForStop(stopId);
  if (!directLines || directLines.length === 0) return [];

  const reachableStops = new Set<number>();
  for (const lineId of directLines) {
    const lineInfo = catalog.find(l => l.id === lineId);
    if (!lineInfo) continue;
    
    for (const dir of Object.values(lineInfo.directions)) {
      if (dir.stops.includes(stopId)) {
        dir.stops.forEach(s => reachableStops.add(s));
      }
    }
  }

  reachableStops.delete(stopId);
  
  const results: ConnectionEntry[] = [];
  for (const sId of reachableStops) {
    const s = await resolveStop(sId);
    if (s) {
      results.push({
        stopId: s.stopId,
        name: s.name,
        lat: s.lat,
        lng: s.lng,
        lines: getLinesForStop(sId),
      });
    }
  }

  return results;
}
