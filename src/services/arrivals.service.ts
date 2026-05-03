import * as legacyApi from '../sources/legacyApi';
import { CACHE_TTL } from '../config';
import { Arrival, Stop } from '../types';
import { getColor, resolveStop } from '../utils/helpers';
import { getStops } from '../sources/openData';
import stopsMinData from '../../data/stops.min.json';

// ─── In-memory arrivals cache with periodic cleanup ──────────────────
const arrivalsCache = new Map<string, { data: any; ts: number }>();

function cleanArrivalsCache(): void {
  const now = Date.now();
  const ttl = CACHE_TTL.arrivals;
  for (const [key, entry] of arrivalsCache) {
    if (now - entry.ts > ttl) {
      arrivalsCache.delete(key);
    }
  }
}

function cacheKey(stopId: number, lineFilter?: string): string {
  return lineFilter ? `${stopId}:${lineFilter.toUpperCase()}` : `${stopId}`;
}

export async function fetchArrivalsForLine(lineId: string, stopId: number) {
  const arrivals = await legacyApi.getArrivals(stopId);
  if (!Array.isArray(arrivals)) {
    throw new Error('Legacy API returned non-array response');
  }
  return arrivals.filter((a: any) => a.lineId === lineId);
}

export async function fetchSmartArrivals(stopId: number, lineFilter?: string, refresh = false) {
  const stop = await resolveStop(stopId);
  if (!stop) return null;

  const key = cacheKey(stopId, lineFilter);
  if (!refresh) {
    const cached = arrivalsCache.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL.arrivals) {
      return cached.data;
    }
  }

  const arrivalsRaw = await legacyApi.getArrivals(stopId, lineFilter);
  if (!arrivalsRaw || 'error' in arrivalsRaw) {
    throw new Error('legacy_unavailable');
  }

  const rawData = arrivalsRaw as any[];
  const arrivalEntries: any[] = Array.isArray(rawData[0]) ? rawData[0] : [];

  const arrivals: Arrival[] = arrivalEntries.map((entry: any[]): Arrival => {
    const minutesRaw = entry[2] !== undefined ? entry[2] : null;
    const minutesValid = minutesRaw !== null && minutesRaw >= 0 ? minutesRaw : null;
    return {
      line: entry[0],
      destination: entry[1],
      color: getColor(entry[0]),
      minutes: minutesValid,
      next: entry[3] !== undefined && entry[3] >= 0 ? entry[3] : null,
      active: minutesValid !== null,
    };
  });

  const response: any = {
    stop: { stopId: stop.stopId, name: stop.name, lat: stop.lat, lng: stop.lng },
    updated: new Date().toISOString(),
    arrivals,
    all_lines: [],
  };

  if (lineFilter) {
    const upcomingNames: string[] = rawData[1] || [];
    const allStops = await getStops();

    const nameToStop = new Map<string, Stop>();
    for (const s of allStops) {
      nameToStop.set(s.name.toUpperCase(), s);
    }
    
    const stopsMin = stopsMinData as unknown as Record<string, [number, number, number, string]>;
    for (const [key, val] of Object.entries(stopsMin)) {
      const upper = val[3].toUpperCase();
      if (!nameToStop.has(upper)) {
        nameToStop.set(upper, {
          stopId: Number(key),
          name: val[3],
          lat: val[1],
          lng: val[2],
          address: null,
          sentido: null,
          lines: [],
          source: 'stops_min',
        });
      }
    }

    const upcomingStops = upcomingNames.map((name: string) => {
      const found = nameToStop.get(name.toUpperCase());
      if (found) return { stopId: found.stopId, name: found.name, lat: found.lat, lng: found.lng };
      return { name, stopId: null, lat: 0, lng: 0 };
    });

    for (const arrival of arrivals) {
      (arrival as any).stops = upcomingStops;
    }

    response.all_lines = [lineFilter];
  } else {
    response.all_lines = rawData[1] || [];
  }

  cleanArrivalsCache();
  arrivalsCache.set(key, { data: response, ts: Date.now() });

  return response;
}

export async function fetchRawArrival(stopId: number, lineLabel?: string) {
  const arrivalsRaw = await legacyApi.getArrivals(stopId, lineLabel);
  if (!arrivalsRaw || 'error' in arrivalsRaw) {
    throw new Error('legacy_unavailable');
  }

  const rawData = arrivalsRaw as any[];
  return Array.isArray(rawData[0]) ? rawData[0] : [];
}
