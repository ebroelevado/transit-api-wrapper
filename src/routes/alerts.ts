import { Router, Request, Response } from 'express';
import * as lineIndex from '../sources/lineIndex';
import * as legacyApi from '../sources/legacyApi';
import path from 'path';
import { DATA_DIR } from '../config';
import { toScheduleId, getDayType, getTextColor } from '../utils/lineMapping';

const router = Router();

// ─── Scratch cache for line status page ─────────────────────────────

let statusCache = new Map<string, { data: any; ts: number }>();
const STATUS_CACHE_TTL = 30_000; // 30 seconds

// ─── Helpers ────────────────────────────────────────────────────────

interface SchedulesRaw {
  horarios_hardcoded: Record<string, Record<string, string[]>>;
}

let schedulesCache: SchedulesRaw | null = null;

function loadSchedules(): SchedulesRaw {
  if (schedulesCache) return schedulesCache;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  schedulesCache = require(path.join(DATA_DIR, 'schedules.json')) as SchedulesRaw;
  return schedulesCache;
}

/** Parse "HH:MM" into minutes since midnight. */
function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** Get current time in "HH:MM" format. */
function currentTimeStr(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

// ─── GET /api/v1/alerts ─────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/alerts:
 *   get:
 *     tags: [Alerts]
 *     summary: Alertas activas del servicio TUS
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */
router.get('/alerts', (_req: Request, res: Response) => {
  res.json({
    alerts: [],
    total: 0,
    source: 'static',
  });
});

// ─── GET /api/v1/lines/:line/status ─────────────────────────────────

/**
 * @swagger
 * /api/v1/lines/{line}/status:
 *   get:
 *     tags: [Alerts]
 *     summary: "Estado operativo de una línea: activa, frecuencia, próximos buses"
 *     parameters:
 *       - in: path
 *         name: line
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */
router.get('/lines/:line/status', async (req: Request, res: Response) => {
  const lineId = req.params.line as string;

  try {
    await lineIndex.buildLineIndex();
    const info = lineIndex.getLine(lineId);

    if (!info) {
      return res.status(404).json({
        error: 'line_not_found', message: `La línea '${lineId}' no existe`,
        source: 'cache', timestamp: new Date().toISOString(),
      });
    }

    // Check cache
    const cached = statusCache.get(lineId);
    if (cached && Date.now() - cached.ts < STATUS_CACHE_TTL) {
      return res.json(cached.data);
    }

    // Try to get real-time arrivals to check activity
    let lastKnownBusMinutesAgo: number | null = null;
    let isActive = true;

    // Use the first stop of direction 1 to check for buses
    const dir1Stops = info.directions['1']?.stops;
    if (dir1Stops && dir1Stops.length > 0) {
      const checkStop = dir1Stops[0];
      const arrivalsRaw = await legacyApi.getArrivals(checkStop);

      if (!arrivalsRaw || 'error' in arrivalsRaw) {
        // Legacy API unavailable — assume active
        isActive = info.active;
      } else {
        const rawData = arrivalsRaw as any[];
        const entries = rawData[0] || [];
        const lineArrivals = entries.filter((e: any[]) => e[0] === lineId);
        if (lineArrivals.length > 0 && lineArrivals[0][2] !== undefined) {
          lastKnownBusMinutesAgo = lineArrivals[0][2];
          isActive = true;
        } else {
          isActive = false;
        }
      }
    }

    // Get schedule info
    const scheduleId = toScheduleId(lineId);
    let scheduleStatus = 'unavailable';
    let nextScheduled: string | null = null;
    let serviceFirst: string | null = null;
    let serviceLast: string | null = null;

    if (scheduleId) {
      const schedules = loadSchedules().horarios_hardcoded;
      const day = getDayType();
      const key = `${scheduleId}-1`; // direction 1
      const entry = schedules[key];
      if (entry && entry[day] && entry[day].length > 0) {
        const times = entry[day];
        serviceFirst = times[0];
        serviceLast = times[times.length - 1];

        // Find next scheduled time
        const now = currentTimeStr();
        const nowMins = timeToMinutes(now);
        for (const t of times) {
          if (timeToMinutes(t) >= nowMins) {
            nextScheduled = t;
            break;
          }
        }
        scheduleStatus = nextScheduled ? 'active' : 'service_ended';
      }
    }

    const response = {
      line: lineId,
      active: isActive,
      frequency_min: 15,
      has_alerts: false,
      alerts: [] as any[],
      last_known_bus_minutes_ago: lastKnownBusMinutesAgo,
      schedule: {
        status: scheduleStatus,
        next_scheduled: nextScheduled,
        service_hours: serviceFirst && serviceLast
          ? { first: serviceFirst, last: serviceLast }
          : null,
      },
    };

    // Cache
    statusCache.set(lineId, { data: response, ts: Date.now() });

    res.json(response);
  } catch (err: any) {
    console.error('[alerts] Error:', err?.message || err);
    res.status(500).json({
      error: 'internal_error',
      message: err?.message || 'Internal error',
      source: 'internal',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
