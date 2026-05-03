import { Router, Request, Response } from 'express';
import * as legacyApi from '../sources/legacyApi';
import { CACHE_TTL } from '../config';
import { resolveStop, formatLocalTime, getColor, getMadridOffset } from '../utils/helpers';

const router = Router();

// ─── ETD cache (same pattern as arrivalsCache) ─────────────────────

const etdCache = new Map<string, { data: any; ts: number }>();

function etdCacheKey(stopId: number): string {
  return `etd:${stopId}`;
}

// ─── Shared ETD logic ──────────────────────────────────────────────

interface EtdEntry {
  line: string;
  destination: string;
  color: string;
  minutes: number | null;
  etd: string | null;
  etd_local: string | null;
}

function computeEtds(entries: any[], serverTime: Date): EtdEntry[] {
  return entries.map((entry: any[]): EtdEntry => {
    const minutes = entry[2] !== undefined ? entry[2] : null;
    const etdDate = minutes !== null ? new Date(serverTime.getTime() + minutes * 60 * 1000) : null;
    return {
      line: entry[0],
      destination: entry[1],
      color: getColor(entry[0]),
      minutes,
      etd: etdDate ? etdDate.toISOString() : null,
      etd_local: etdDate ? formatLocalTime(etdDate) : null,
    };
  });
}

// ─── GET /api/v1/now ────────────────────────────────────────────────

router.get('/now', (_req: Request, res: Response) => {
  const now = new Date();
  const madridParts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => madridParts.find(p => p.type === type)?.value || '00';
  const localTime = `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}${getMadridOffset()}`;

  res.json({
    server_time: now.toISOString(),
    timezone: 'Europe/Madrid',
    local_time: localTime,
  });
});

// ─── GET /api/v1/stops/:stop/etd ────────────────────────────────────

router.get('/stops/:stop/etd', async (req: Request, res: Response) => {
  try {
    const stopId = parseInt(req.params.stop as string, 10);
    if (isNaN(stopId)) {
      return res.status(400).json({
        error: 'invalid_params', message: 'stop must be a number', source: 'legacy_api',
        timestamp: new Date().toISOString(),
      });
    }

    // Check ETD cache
    const key = etdCacheKey(stopId);
    const cached = etdCache.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL.arrivals) {
      return res.json(cached.data);
    }

    const stop = await resolveStop(stopId);
    if (!stop) {
      return res.status(404).json({
        error: 'stop_not_found', message: `La parada ${stopId} no existe`, source: 'open_data',
        timestamp: new Date().toISOString(),
      });
    }

    const arrivalsRaw = await legacyApi.getArrivals(stopId);

    if (!arrivalsRaw || 'error' in arrivalsRaw) {
      return res.status(503).json({
        error: 'legacy_unavailable', message: 'Legacy API no responde', source: 'legacy_api',
        timestamp: new Date().toISOString(),
      });
    }

    const rawData = arrivalsRaw as any[];
    const entries: any[] = Array.isArray(rawData[0]) ? rawData[0] : [];
    const serverTime = new Date();

    const arrivals = computeEtds(entries, serverTime);

    const response = {
      stop: { stopId: stop.stopId, name: stop.name, lat: stop.lat, lng: stop.lng },
      server_time: serverTime.toISOString(),
      arrivals,
    };

    // Cache
    etdCache.set(key, { data: response, ts: Date.now() });

    res.json(response);
  } catch (err: any) {
    console.error('[time] Error:', err?.message || err);
    res.status(500).json({
      error: 'internal_error', message: err?.message || 'Internal error', source: 'internal',
      timestamp: new Date().toISOString(),
    });
  }
});

// ─── GET /api/v1/stops/:stop/arrivals/absolute ──────────────────────

router.get('/stops/:stop/arrivals/absolute', async (req: Request, res: Response) => {
  try {
    const stopId = parseInt(req.params.stop as string, 10);
    if (isNaN(stopId)) {
      return res.status(400).json({
        error: 'invalid_params', message: 'stop must be a number', source: 'legacy_api',
        timestamp: new Date().toISOString(),
      });
    }

    const stop = await resolveStop(stopId);
    if (!stop) {
      return res.status(404).json({
        error: 'stop_not_found', message: `La parada ${stopId} no existe`, source: 'open_data',
        timestamp: new Date().toISOString(),
      });
    }

    const arrivalsRaw = await legacyApi.getArrivals(stopId);

    if (!arrivalsRaw || 'error' in arrivalsRaw) {
      return res.status(503).json({
        error: 'legacy_unavailable', message: 'Legacy API no responde', source: 'legacy_api',
        timestamp: new Date().toISOString(),
      });
    }

    const rawData = arrivalsRaw as any[];
    const entries: any[] = Array.isArray(rawData[0]) ? rawData[0] : [];
    const serverTime = new Date();

    const arrivals = computeEtds(entries, serverTime);

    res.json({
      stop: { stopId: stop.stopId, name: stop.name, lat: stop.lat, lng: stop.lng },
      server_time: serverTime.toISOString(),
      arrivals,
      all_lines: rawData[1] || [],
    });
  } catch (err: any) {
    console.error('[time] Error:', err?.message || err);
    res.status(500).json({
      error: 'internal_error', message: err?.message || 'Internal error', source: 'internal',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
