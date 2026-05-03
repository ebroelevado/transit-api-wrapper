import fetch from 'node-fetch';
import { Stop } from '../types';
import { OPEN_DATA_URL, CACHE_TTL } from '../config';
import logger from '../utils/logger';
import Fuse from 'fuse.js';

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
        logger.error({ status: res.status }, '[openData] HTTP error fetching stops');
        return Array.from(cache.values());
      }

      const data = (await res.json()) as OpenDataResponse;

      if (!data.resources || !Array.isArray(data.resources)) {
        logger.error('[openData] Unexpected response shape');
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
      logger.info({ count: cache.size }, '[openData] Stops loaded');
      return Array.from(cache.values());
    } catch (err) {
      logger.error({ err }, '[openData] Fetch error');
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

// ─── Fuzzy search index ────────────────────────────────────────────
// The Fuse instance is built lazily once, and invalidated when the cache refreshes.

let fuseIndex: Fuse<Stop> | null = null;
let fuseBuiltAt = 0;

function getFuse(stops: Stop[]): Fuse<Stop> {
  // Rebuild if cache was refreshed since the index was built
  if (!fuseIndex || fuseBuiltAt < lastFetch) {
    fuseIndex = new Fuse(stops, {
      keys: [
        { name: 'name',    weight: 0.7 },
        { name: 'address', weight: 0.2 },
        { name: 'stopId',  weight: 0.1 },
      ],
      threshold: 0.35,       // 0 = exact, 1 = match everything
      ignoreLocation: true,  // search anywhere in the string, not just the start
      includeScore: true,
      minMatchCharLength: 2,
    });
    fuseBuiltAt = Date.now();
  }
  return fuseIndex;
}

/**
 * Hybrid search: exact substring matches first, then fuzzy.
 * If the query is a pure number, searches by stopId.
 */
export async function searchStops(query: string): Promise<Stop[]> {
  const stops = await fetchAllStops();
  const q = query.trim();

  // Numeric query → stopId exact match
  if (/^\d+$/.test(q)) {
    const id = parseInt(q, 10);
    const exact = cache.get(id);
    return exact ? [exact] : stops.filter(s => String(s.stopId).startsWith(q));
  }

  const qLow = q.toLowerCase();

  // Priority 1: exact substring (fast, no false positives)
  const exact = stops.filter(
    s => s.name.toLowerCase().includes(qLow) ||
         (s.address && s.address.toLowerCase().includes(qLow))
  );

  if (exact.length > 0) return exact;

  // Priority 2: fuzzy match (tolerates typos)
  const fuse = getFuse(stops);
  return fuse.search(q).map(r => r.item);
}

export function getCacheAge(): number {
  return lastFetch > 0 ? Date.now() - lastFetch : 0;
}

export async function getStopCount(): Promise<number> {
  const stops = await fetchAllStops();
  return stops.length;
}
