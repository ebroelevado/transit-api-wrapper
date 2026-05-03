import fetch from 'node-fetch';
import { Stop } from '../types';
import { OPEN_DATA_URL, CACHE_TTL } from '../config';

// ─── In-memory cache ───────────────────────────────────────────────

const cache = new Map<number, Stop>();
let lastFetch = 0;
let fetchPromise: Promise<Stop[]> | null = null;

// ─── Internal raw API shape ────────────────────────────────────────

interface OpenDataResource {
  'ayto:numero': string;
  'ayto:parada': string;
  'wgs84_pos:lat': number;
  'wgs84_pos:long': number;
  'ayto:sentido'?: string;
  'vivo:address1'?: string;
}

interface OpenDataResponse {
  summary: { items: number };
  resources: OpenDataResource[];
}

// ─── Fetch & cache ─────────────────────────────────────────────────

async function fetchAllStops(): Promise<Stop[]> {
  const now = Date.now();

  // Return cached result if still fresh
  if (cache.size > 0 && now - lastFetch < CACHE_TTL.stops) {
    return Array.from(cache.values());
  }

  // Deduplicate concurrent calls
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    try {
      const res = await fetch(OPEN_DATA_URL);
      if (!res.ok) {
        console.error(`[openData] HTTP ${res.status} fetching stops`);
        return Array.from(cache.values());
      }

      const data = (await res.json()) as OpenDataResponse;

      if (!data.resources || !Array.isArray(data.resources)) {
        console.error('[openData] Unexpected response shape');
        return Array.from(cache.values());
      }

      // Build into a temporary map first, then atomically replace
      const newCache = new Map<number, Stop>();

      for (const r of data.resources) {
        const stopId = parseInt(r['ayto:numero'], 10);
        if (isNaN(stopId)) continue;

        const stop: Stop = {
          stopId,
          name: r['ayto:parada'] ?? '',
          lat: Number(r['wgs84_pos:lat']),
          lng: Number(r['wgs84_pos:long']),
          address: r['vivo:address1'] ?? null,
          sentido: r['ayto:sentido'] ?? null,
          lines: [],
          source: 'open_data',
        };

        newCache.set(stopId, stop);
      }

      // Atomically replace: clear old cache and copy new entries
      cache.clear();
      for (const [k, v] of newCache) {
        cache.set(k, v);
      }

      lastFetch = now;
      console.log(`[openData] Loaded ${cache.size} stops`);
      return Array.from(cache.values());
    } catch (err) {
      console.error('[openData] Fetch error:', err);
      // Return whatever we had cached (may be empty)
      return Array.from(cache.values());
    } finally {
      fetchPromise = null;
    }
  })();

  return fetchPromise;
}

// ─── Public API ────────────────────────────────────────────────────

export async function getStops(): Promise<Stop[]> {
  return fetchAllStops();
}

export async function getStopById(id: number): Promise<Stop | null> {
  const stops = await fetchAllStops();
  return cache.get(id) ?? null;
}

export async function searchStops(query: string): Promise<Stop[]> {
  const stops = await fetchAllStops();
  const q = query.toLowerCase();
  return stops.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      (s.address && s.address.toLowerCase().includes(q)) ||
      String(s.stopId).includes(q)
  );
}

export function getCacheAge(): number {
  return lastFetch > 0 ? Date.now() - lastFetch : 0;
}

export async function getStopCount(): Promise<number> {
  const stops = await fetchAllStops();
  return stops.length;
}
