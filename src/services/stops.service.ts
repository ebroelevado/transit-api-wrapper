import * as openData from '../sources/openData';
import * as lineIndex from '../sources/lineIndex';
import { haversine } from '../utils/haversine';
import { NEARBY_RADIUS } from '../config';
import { resolveStop } from '../utils/helpers';
import { Stop } from '../types';

// ─── Nearby cache (stopId → nearby stops, TTL 5 min) ───────────────
const nearbyCache = new Map<number, { data: { stopId: number; name: string; meters: number }[]; ts: number }>();
const NEARBY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Periodic cleanup
const CLEANUP_INTERVAL = 60_000;
let lastCleanup = Date.now();
function cleanNearbyCache(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, entry] of nearbyCache) {
    if (now - entry.ts > NEARBY_CACHE_TTL) {
      nearbyCache.delete(key);
    }
  }
}

export async function findNearbyStops(lat: number, lng: number, radius: number, limit: number) {
  const allStops = await openData.getStops();
  const results = allStops
    .map(s => ({
      stopId: s.stopId,
      name: s.name,
      lat: s.lat,
      lng: s.lng,
      meters: Math.round(haversine(lat, lng, s.lat, s.lng)),
    }))
    .filter(s => s.meters <= radius)
    .sort((a, b) => a.meters - b.meters)
    .slice(0, limit);

  return results;
}

export async function searchStops(q: string | undefined, offset: number, limit: number) {
  let results: Stop[];
  if (q) {
    results = await openData.searchStops(q);
  } else {
    results = await openData.getStops();
  }

  results = results.map(s => ({ ...s, lines: lineIndex.getLinesForStop(s.stopId) }));
  const paged = results.slice(offset, offset + limit);

  return { paged, total: results.length };
}

export async function getStopDetails(stopId: number) {
  const stop = await resolveStop(stopId);
  if (!stop) return null;

  await lineIndex.buildLineIndex();
  const lines = lineIndex.getLinesForStop(stopId);
  const allLines = lineIndex.getLines().filter(l => lines.includes(l.id));

  cleanNearbyCache();

  let nearby: { stopId: number; name: string; meters: number }[];
  const cached = nearbyCache.get(stopId);
  if (cached && Date.now() - cached.ts < NEARBY_CACHE_TTL) {
    nearby = cached.data;
  } else {
    const allStops = await openData.getStops();
    nearby = allStops
      .filter(s => s.stopId !== stopId)
      .map(s => ({ stopId: s.stopId, name: s.name, meters: Math.round(haversine(stop.lat, stop.lng, s.lat, s.lng)) }))
      .filter(s => s.meters <= NEARBY_RADIUS)
      .sort((a, b) => a.meters - b.meters)
      .slice(0, 10);
    nearbyCache.set(stopId, { data: nearby, ts: Date.now() });
  }

  return {
    stopId: stop.stopId,
    name: stop.name,
    lat: stop.lat,
    lng: stop.lng,
    address: stop.address,
    sentido: stop.sentido,
    source: stop.source,
    lines: allLines.map(l => ({ id: l.id, color: l.color, destinations: Object.values(l.destinations) })),
    nearby,
  };
}
