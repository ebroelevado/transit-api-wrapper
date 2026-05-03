import { Router, Request, Response } from 'express';
import * as openData from '../sources/openData';
import * as legacyApi from '../sources/legacyApi';
import * as lineIndex from '../sources/lineIndex';
import { CACHE_TTL } from '../config';
import { Arrival, Stop } from '../types';
import colorsRaw from '../../data/colors.json';
import stopsMinRaw from '../../data/stops.min.json';

const router = Router();
const stopsMin = stopsMinRaw as unknown as Record<string, [number, number, number, string]>;

// ─── Helpers ────────────────────────────────────────────────────────

/** Convert RGB array to hex color string. */
function rgbToHex(rgb: number[]): string {
  const [r, g, b] = rgb;
  return (
    '#' +
    [r, g, b]
      .map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

/** Get hex color for a line ID, with default fallback. */
function getColor(lineId: string): string {
  const colors = colorsRaw as Record<string, number[]>;
  const rgb = colors[lineId] || colors['default'];
  return rgbToHex(rgb);
}

/** Resolve a stop from Open Data, falling back to stops.min.json. */
async function resolveStop(stopId: number): Promise<Stop | null> {
  const od = await openData.getStopById(stopId);
  if (od) return od;
  const key = String(stopId);
  if (stopsMin[key]) {
    const [, lat, lng, name] = stopsMin[key];
    return { stopId, name, lat, lng, address: null, sentido: null, lines: [], source: 'stops_min' };
  }
  return null;
}

/** Look up a stop's coords (Open Data first, stops.min.json fallback). Returns null if unknown. */
function getStopCoords(stopId: number): { name: string; lat: number; lng: number } | null {
  const key = String(stopId);
  if (stopsMin[key]) {
    const [, lat, lng, name] = stopsMin[key];
    return { name, lat, lng };
  }
  return null;
}

// ─── In-memory arrivals cache ───────────────────────────────────────

const arrivalsCache = new Map<string, { data: any; ts: number }>();

function cacheKey(stopId: number, lineLabel?: string): string {
  return lineLabel ? `${stopId}:${lineLabel}` : `${stopId}`;
}

// ─── GET /api/v1/stops/:stop/arrivals ───────────────────────────────
// Params: ?line=X&refresh=true

/**
 * @swagger
 * /api/v1/stops/{stop}/arrivals:
 *   get:
 *     tags: [Arrivals]
 *     summary: Llegadas en tiempo real con geolocalización de próximas paradas
 *     parameters:
 *       - in: path
 *         name: stop
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID numérico de la parada
 *       - in: query
 *         name: line
 *         required: false
 *         schema:
 *           type: string
 *         description: Filtrar por línea
 *       - in: query
 *         name: refresh
 *         required: false
 *         schema:
 *           type: boolean
 *         description: Forzar refresh ignorando caché
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 stop:
 *                   type: object
 *                   properties:
 *                     stopId:
 *                       type: number
 *                     name:
 *                       type: string
 *                     lat:
 *                       type: number
 *                     lng:
 *                       type: number
 *                 updated:
 *                   type: string
 *                   format: date-time
 *                 arrivals:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       line:
 *                         type: string
 *                       destination:
 *                         type: string
 *                       color:
 *                         type: string
 *                       minutes:
 *                         type: number
 *                         nullable: true
 *                       next:
 *                         type: number
 *                         nullable: true
 *                       active:
 *                         type: boolean
 *                       stops:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             stopId:
 *                               type: number
 *                               nullable: true
 *                             name:
 *                               type: string
 *                             lat:
 *                               type: number
 *                             lng:
 *                               type: number
 *                 all_lines:
 *                   type: array
 *                   items:
 *                     type: string
 *       400:
 *         description: Invalid parameters
 *       404:
 *         description: Stop not found
 *       503:
 *         description: Legacy API unavailable
 *       500:
 *         description: Internal error
 */
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
  const arrivalEntries = rawData[0] || [];

  // Parse arrivals
  const arrivals: any[] = arrivalEntries.map((entry: any[]) => ({
    line: entry[0],
    destination: entry[1],
    color: getColor(entry[0]),
    minutes: entry[2] !== undefined ? entry[2] : null,
    next: entry[3] !== undefined ? entry[3] : null,
    active: true,
  }));

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
    for (const arrival of arrivals) {
      // Look up stops by name
      const allStops = await openData.getStops();
      arrival.stops = upcomingNames.map((name: string) => {
        const found = allStops.find(s => s.name.toUpperCase() === name.toUpperCase());
        if (found) return { stopId: found.stopId, name: found.name, lat: found.lat, lng: found.lng };
        // Fallback: try stops.min.json
        for (const [key, val] of Object.entries(stopsMin)) {
          if (val[3].toUpperCase() === name.toUpperCase()) {
            return { stopId: Number(key), name: val[3], lat: val[1], lng: val[2] };
          }
        }
        return { name, stopId: null, lat: 0, lng: 0 };
      });
    }
    response.all_lines = [lineFilter];
  } else {
    // Without line filter, second element contains allLineLabels
    response.all_lines = rawData[1] || [];
  }

  // Cache the response
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

/**
 * @swagger
 * /api/v1/stops/{stop}/arrivals/{line}:
 *   get:
 *     tags: [Arrivals]
 *     summary: Llegadas filtradas por línea específica
 *     parameters:
 *       - in: path
 *         name: stop
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID numérico de la parada
 *       - in: path
 *         name: line
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la línea
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 line:
 *                   type: string
 *                 destination:
 *                   type: string
 *                   nullable: true
 *                 color:
 *                   type: string
 *                 minutes:
 *                   type: number
 *                   nullable: true
 *                 next:
 *                   type: number
 *                   nullable: true
 *                 active:
 *                   type: boolean
 *       400:
 *         description: Invalid parameters
 *       503:
 *         description: Legacy API unavailable
 *       500:
 *         description: Internal error
 */
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

  const arrivalsRaw = await legacyApi.getArrivals(stopId, lineLabel);

  if (!arrivalsRaw || 'error' in arrivalsRaw) {
    return res.status(503).json({
      error: 'legacy_unavailable', message: 'Legacy API no responde', source: 'legacy_api',
      timestamp: new Date().toISOString(),
    });
  }

  const rawData = arrivalsRaw as any[];
  const entries = rawData[0] || [];

  if (entries.length === 0) {
    // No active arrivals for this line
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
    minutes: entry[2] !== undefined ? entry[2] : null,
    next: entry[3] !== undefined ? entry[3] : null,
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

/**
 * @swagger
 * /api/v1/stops/{stop}/next:
 *   get:
 *     tags: [Arrivals]
 *     summary: Solo el próximo autobús (respuesta mínima)
 *     parameters:
 *       - in: path
 *         name: stop
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID numérico de la parada
 *     responses:
 *       200:
 *         description: OK — null si no hay buses
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               nullable: true
 *               properties:
 *                 line:
 *                   type: string
 *                   nullable: true
 *                 destination:
 *                   type: string
 *                   nullable: true
 *                 minutes:
 *                   type: number
 *                   nullable: true
 *                 color:
 *                   type: string
 *                   nullable: true
 *       400:
 *         description: Invalid parameters
 *       503:
 *         description: Legacy API unavailable
 *       500:
 *         description: Internal error
 */
router.get('/stops/:stop/next', async (req: Request, res: Response) => {
  try {
  const stopId = parseInt(req.params.stop as string, 10);
  if (isNaN(stopId)) {
    return res.status(400).json({
      error: 'invalid_params', message: 'stop must be a number', source: 'legacy_api',
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
  const entries = rawData[0] || [];

  if (entries.length === 0) {
    return res.json({
      line: null, destination: null, minutes: null, color: null,
    });
  }

  const first = entries[0];
  res.json({
    line: first[0],
    destination: first[1],
    minutes: first[2] !== undefined ? first[2] : null,
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

/**
 * @swagger
 * /api/v1/stops/{stop}/next/{line}:
 *   get:
 *     tags: [Arrivals]
 *     summary: Próximo autobús de una línea concreta
 *     parameters:
 *       - in: path
 *         name: stop
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID numérico de la parada
 *       - in: path
 *         name: line
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la línea
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 line:
 *                   type: string
 *                 destination:
 *                   type: string
 *                   nullable: true
 *                 minutes:
 *                   type: number
 *                   nullable: true
 *                 next:
 *                   type: number
 *                   nullable: true
 *                 color:
 *                   type: string
 *                 active:
 *                   type: boolean
 *       400:
 *         description: Invalid parameters
 *       503:
 *         description: Legacy API unavailable
 *       500:
 *         description: Internal error
 */
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

  const arrivalsRaw = await legacyApi.getArrivals(stopId, lineLabel);

  if (!arrivalsRaw || 'error' in arrivalsRaw) {
    return res.status(503).json({
      error: 'legacy_unavailable', message: 'Legacy API no responde', source: 'legacy_api',
      timestamp: new Date().toISOString(),
    });
  }

  const rawData = arrivalsRaw as any[];
  const entries = rawData[0] || [];

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
    minutes: entry[2] !== undefined ? entry[2] : null,
    next: entry[3] !== undefined ? entry[3] : null,
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

/**
 * @swagger
 * /api/v1/lines/{line}/next-at/{stop}:
 *   get:
 *     tags: [Arrivals]
 *     summary: "Búsqueda inversa: ¿cuándo pasa esta línea por esta parada?"
 *     parameters:
 *       - in: path
 *         name: line
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la línea
 *       - in: path
 *         name: stop
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID numérico de la parada
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 line:
 *                   type: string
 *                 stop:
 *                   type: number
 *                 stop_name:
 *                   type: string
 *                 destination:
 *                   type: string
 *                   nullable: true
 *                 minutes:
 *                   type: number
 *                   nullable: true
 *                 next:
 *                   type: number
 *                   nullable: true
 *                 active:
 *                   type: boolean
 *       400:
 *         description: Invalid parameters
 *       503:
 *         description: Legacy API unavailable
 *       500:
 *         description: Internal error
 */
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
  const entries = rawData[0] || [];

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
    minutes: entry[2] !== undefined ? entry[2] : null,
    next: entry[3] !== undefined ? entry[3] : null,
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
