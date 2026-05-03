import { Router, Request, Response } from 'express';
import * as openData from '../sources/openData';
import * as legacyApi from '../sources/legacyApi';
import { CACHE_TTL } from '../config';
import colorsRaw from '../../data/colors.json';
import stopsMinRaw from '../../data/stops.min.json';
import { Stop } from '../types';

const router = Router();
const stopsMin = stopsMinRaw as unknown as Record<string, [number, number, number, string]>;

// ─── Helpers ────────────────────────────────────────────────────────

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

function getColor(lineId: string): string {
  const colors = colorsRaw as Record<string, number[]>;
  const rgb = colors[lineId] || colors['default'];
  return rgbToHex(rgb);
}

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

/**
 * Format a Date as "HH:MM" in Europe/Madrid local time.
 */
function formatLocalTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ─── GET /api/v1/now ────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/now:
 *   get:
 *     tags: [Time]
 *     summary: Hora actual del servidor con timezone Europe/Madrid
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */
router.get('/now', (_req: Request, res: Response) => {
  const now = new Date();
  res.json({
    server_time: now.toISOString(),
    timezone: 'Europe/Madrid',
    local_time: now.toLocaleString('sv-SE', { timeZone: 'Europe/Madrid' }).replace(' ', 'T') + '+02:00',
  });
});

// ─── GET /api/v1/stops/:stop/etd ────────────────────────────────────

/**
 * @swagger
 * /api/v1/stops/{stop}/etd:
 *   get:
 *     tags: [Time]
 *     summary: Hora estimada de salida (ETD) en ISO 8601
 *     parameters:
 *       - in: path
 *         name: stop
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */
router.get('/stops/:stop/etd', async (req: Request, res: Response) => {
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
  const entries = rawData[0] || [];
  const serverTime = new Date();

  const arrivals = entries.map((entry: any[]) => {
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

  res.json({
    stop: stopId,
    server_time: serverTime.toISOString(),
    arrivals,
  });
  } catch (err: any) {
    console.error('[time] Error:', err?.message || err);
    res.status(500).json({
      error: 'internal_error', message: err?.message || 'Internal error', source: 'internal',
      timestamp: new Date().toISOString(),
    });
  }
});

// ─── GET /api/v1/stops/:stop/arrivals/absolute ──────────────────────

/**
 * @swagger
 * /api/v1/stops/{stop}/arrivals/absolute:
 *   get:
 *     tags: [Time]
 *     summary: Llegadas con hora exacta (alias de ETD)
 *     parameters:
 *       - in: path
 *         name: stop
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */
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
  const entries = rawData[0] || [];
  const serverTime = new Date();

  const arrivals = entries.map((entry: any[]) => {
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

  res.json({
    stop: stopId,
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
