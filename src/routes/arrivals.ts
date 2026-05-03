import { Router, Request, Response } from 'express';
import * as legacyApi from '../sources/legacyApi';
import { CACHE_TTL } from '../config';
import { Arrival, Stop } from '../types';
import { getColor, resolveStop } from '../utils/helpers';

const router = Router();

// ─── In-memory arrivals cache with periodic cleanup ──────────────────

const arrivalsCache = new Map<string, { data: any; ts: number }>();

/** Clean up expired cache entries. Called before cache writes. */
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

// ─── GET /api/v1/stops/:stop/arrivals ───────────────────────────────

router.get('/stops/:stop/arrivals', async (req: Request, res: Response) => {
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

    const lineFilter = req.query.line as string | undefined;
    const refresh = req.query.refresh === 'true';
    const key = cacheKey(stopId, lineFilter);

    // Check cache (skip if refresh=true)
    if (!refresh) {
      const cached = arrivalsCache.get(key);
      if (cached && Date.now() - cached.ts < CACHE_TTL.arrivals) {
        return res.json(cached.data);
      }
    }

    const arrivalsRaw = await legacyApi.getArrivals(stopId, lineFilter);

    if (!arrivalsRaw || 'error' in arrivalsRaw) {
      return res.status(503).json({
        error: 'legacy_unavailable', message: 'Legacy API no responde', source: 'legacy_api',
        timestamp: new Date().toISOString(),
      });
    }

    const rawData = arrivalsRaw as any[];

    // Guard: ensure first element is an array before mapping
    const arrivalEntries: any[] = Array.isArray(rawData[0]) ? rawData[0] : [];

    // Parse arrivals — validate negative minutes
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

    // Build response
    const response: any = {
      stop: { stopId: stop.stopId, name: stop.name, lat: stop.lat, lng: stop.lng },
      updated: new Date().toISOString(),
      arrivals,
      all_lines: [],
    };

    if (lineFilter) {
      // When line is filtered, second element contains upcoming stop NAMES (strings, not IDs)
      const upcomingNames: string[] = rawData[1] || [];

      // Fetch all stops ONCE before the loop (was inside loop — CRITICAL fix)
      const { getStops } = await import('../sources/openData');
      const allStops = await getStops();

      // Build a name→Stop map for O(1) lookup
      const nameToStop = new Map<string, Stop>();
      for (const s of allStops) {
        nameToStop.set(s.name.toUpperCase(), s);
      }
      // Also add stops.min.json entries
      const stopsMin = (await import('../../data/stops.min.json')).default as unknown as Record<string, [number, number, number, string]>;
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

      // Now map upcoming names to stops using O(1) lookup
      const upcomingStops = upcomingNames.map((name: string) => {
        const found = nameToStop.get(name.toUpperCase());
        if (found) return { stopId: found.stopId, name: found.name, lat: found.lat, lng: found.lng };
        return { name, stopId: null, lat: 0, lng: 0 };
      });

      // Apply the same stops array to every arrival (they share the route)
      for (const arrival of arrivals) {
        (arrival as any).stops = upcomingStops;
      }

      response.all_lines = [lineFilter];
    } else {
      response.all_lines = rawData[1] || [];
    }

    // Periodic cache cleanup before writing
    cleanArrivalsCache();
    arrivalsCache.set(key, { data: response, ts: Date.now() });

    res.json(response);
  } catch (err: any) {
    console.error('[arrivals] Error:', err?.message || err);
    res.status(500).json({
      error: 'internal_error', message: 'Failed to get arrivals', source: 'internal',
      timestamp: new Date().toISOString(),
    });
  }
});

// ─── GET /api/v1/stops/:stop/arrivals/:line ─────────────────────────

router.get('/stops/:stop/arrivals/:line', async (req: Request, res: Response) => {
  try {
    const stopId = parseInt(req.params.stop as string, 10);
    const lineLabel = req.params.line as string;

    if (isNaN(stopId)) {
      return res.status(400).json({
        error: 'invalid_params', message: 'stop must be a number', source: 'legacy_api',
        timestamp: new Date().toISOString(),
      });
    }

    // CRITICAL: resolve stop, 404 if not found
    const stop = await resolveStop(stopId);
    if (!stop) {
      return res.status(404).json({
        error: 'stop_not_found', message: `La parada ${stopId} no existe`, source: 'open_data',
        timestamp: new Date().toISOString(),
      });
    }

    const arrivalsRaw = await legacyApi.getArrivals(stopId, lineLabel);

    if (!arrivalsRaw || 'error' in arrivalsRaw) {
      return res.status(503).json({
        error: 'legacy_unavailable', message: 'Legacy API no responde', source: 'legacy_api',
        timestamp: new Date().toISOString(),
      });
    }

    const rawData = arrivalsRaw as any[];
    const entries: any[] = Array.isArray(rawData[0]) ? rawData[0] : [];

    if (entries.length === 0) {
      return res.json({
        line: lineLabel,
        destination: null,
        color: getColor(lineLabel),
        minutes: null,
        next: null,
        active: false,
      });
    }

    const entry = entries[0];
    res.json({
      line: entry[0],
      destination: entry[1],
      color: getColor(entry[0]),
      minutes: entry[2] !== undefined && entry[2] >= 0 ? entry[2] : null,
      next: entry[3] !== undefined && entry[3] >= 0 ? entry[3] : null,
      active: true,
    });
  } catch (err: any) {
    console.error('[arrivals] Error:', err?.message || err);
    res.status(500).json({
      error: 'internal_error', message: err?.message || 'Internal error', source: 'internal',
      timestamp: new Date().toISOString(),
    });
  }
});

// ─── GET /api/v1/stops/:stop/next ───────────────────────────────────

router.get('/stops/:stop/next', async (req: Request, res: Response) => {
  try {
    const stopId = parseInt(req.params.stop as string, 10);
    if (isNaN(stopId)) {
      return res.status(400).json({
        error: 'invalid_params', message: 'stop must be a number', source: 'legacy_api',
        timestamp: new Date().toISOString(),
      });
    }

    // CRITICAL: resolve stop, 404 if not found
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

    if (entries.length === 0) {
      return res.json({
        line: null, destination: null, minutes: null, color: null,
      });
    }

    const first = entries[0];
    res.json({
      line: first[0],
      destination: first[1],
      minutes: first[2] !== undefined && first[2] >= 0 ? first[2] : null,
      color: getColor(first[0]),
    });
  } catch (err: any) {
    console.error('[arrivals] Error:', err?.message || err);
    res.status(500).json({
      error: 'internal_error', message: err?.message || 'Internal error', source: 'internal',
      timestamp: new Date().toISOString(),
    });
  }
});

// ─── GET /api/v1/stops/:stop/next/:line ─────────────────────────────

router.get('/stops/:stop/next/:line', async (req: Request, res: Response) => {
  try {
    const stopId = parseInt(req.params.stop as string, 10);
    const lineLabel = req.params.line as string;

    if (isNaN(stopId)) {
      return res.status(400).json({
        error: 'invalid_params', message: 'stop must be a number', source: 'legacy_api',
        timestamp: new Date().toISOString(),
      });
    }

    // CRITICAL: resolve stop, 404 if not found
    const stop = await resolveStop(stopId);
    if (!stop) {
      return res.status(404).json({
        error: 'stop_not_found', message: `La parada ${stopId} no existe`, source: 'open_data',
        timestamp: new Date().toISOString(),
      });
    }

    const arrivalsRaw = await legacyApi.getArrivals(stopId, lineLabel);

    if (!arrivalsRaw || 'error' in arrivalsRaw) {
      return res.status(503).json({
        error: 'legacy_unavailable', message: 'Legacy API no responde', source: 'legacy_api',
        timestamp: new Date().toISOString(),
      });
    }

    const rawData = arrivalsRaw as any[];
    const entries: any[] = Array.isArray(rawData[0]) ? rawData[0] : [];

    if (entries.length === 0) {
      return res.json({
        line: lineLabel, destination: null, minutes: null, next: null,
        color: getColor(lineLabel), active: false,
      });
    }

    const entry = entries[0];
    res.json({
      line: entry[0],
      destination: entry[1],
      minutes: entry[2] !== undefined && entry[2] >= 0 ? entry[2] : null,
      next: entry[3] !== undefined && entry[3] >= 0 ? entry[3] : null,
      color: getColor(entry[0]),
      active: true,
    });
  } catch (err: any) {
    console.error('[arrivals] Error:', err?.message || err);
    res.status(500).json({
      error: 'internal_error', message: err?.message || 'Internal error', source: 'internal',
      timestamp: new Date().toISOString(),
    });
  }
});

// ─── GET /api/v1/lines/:line/next-at/:stop ──────────────────────────

router.get('/lines/:line/next-at/:stop', async (req: Request, res: Response) => {
  try {
    const lineLabel = req.params.line as string;
    const stopId = parseInt(req.params.stop as string, 10);

    if (isNaN(stopId)) {
      return res.status(400).json({
        error: 'invalid_params', message: 'stop must be a number', source: 'legacy_api',
        timestamp: new Date().toISOString(),
      });
    }

    const stop = await resolveStop(stopId);
    const arrivalsRaw = await legacyApi.getArrivals(stopId, lineLabel);

    if (!arrivalsRaw || 'error' in arrivalsRaw) {
      return res.status(503).json({
        error: 'legacy_unavailable', message: 'Legacy API no responde', source: 'legacy_api',
        timestamp: new Date().toISOString(),
      });
    }

    const rawData = arrivalsRaw as any[];
    const entries: any[] = Array.isArray(rawData[0]) ? rawData[0] : [];

    if (entries.length === 0) {
      return res.json({
        line: lineLabel, stop: stopId, stop_name: stop?.name || `Parada ${stopId}`,
        destination: null, minutes: null, next: null, active: false,
      });
    }

    const entry = entries[0];
    res.json({
      line: entry[0],
      stop: stopId,
      stop_name: stop?.name || `Parada ${stopId}`,
      destination: entry[1],
      minutes: entry[2] !== undefined && entry[2] >= 0 ? entry[2] : null,
      next: entry[3] !== undefined && entry[3] >= 0 ? entry[3] : null,
      active: true,
    });
  } catch (err: any) {
    console.error('[arrivals] Error:', err?.message || err);
    res.status(500).json({
      error: 'internal_error', message: err?.message || 'Internal error', source: 'internal',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
