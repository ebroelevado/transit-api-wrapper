import { Router, Request, Response } from 'express';
import { getArrivals } from '../sources/legacyApi';
import { getLine, buildLineIndex } from '../sources/lineIndex';
import { BATCH_CONCURRENCY } from '../config';
import { Arrival } from '../types';
import { resolveStop } from '../utils/helpers';

const router = Router();

// ─── Helpers ────────────────────────────────────────────────────────

/** Run async tasks with a concurrency limit. Each task is wrapped in try/catch so Promise.all never rejects. */
async function withConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let idx = 0;

  async function worker(): Promise<void> {
    while (idx < tasks.length) {
      const i = idx++;
      try {
        results[i] = await tasks[i]();
      } catch (err: any) {
        // Store error as result so Promise.all doesn't reject
        results[i] = { error: err?.message || 'task_failed' } as unknown as T;
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ─── POST /api/v1/batch/arrivals ───────────────────────────────────

router.post('/arrivals', async (req: Request, res: Response) => {
  try {
    const { stops, lines } = req.body as { stops?: number[]; lines?: string[] };

    if (!stops || !Array.isArray(stops) || stops.length === 0) {
      return res.status(400).json({
        error: 'invalid_params',
        message: 'Request body must contain a non-empty "stops" array',
        source: 'legacy_api',
        timestamp: new Date().toISOString(),
      });
    }

    const start = Date.now();
    const errors: { stop: number; error: string }[] = [];

    const tasks = stops.map((stopId: number) => async () => {
      try {
        const resolved = await resolveStop(stopId);
        const arrivalsRaw = await getArrivals(stopId);

        if (!arrivalsRaw) {
          errors.push({ stop: stopId, error: 'legacy_unavailable' });
          return { stop: stopId, name: resolved?.name || 'Unknown', arrivals: [], error: 'legacy_unavailable' };
        }
        // More specific check: is it an error object rather than an arrivals array?
        if (!Array.isArray(arrivalsRaw)) {
          const errObj = arrivalsRaw as { error?: string };
          if (errObj.error) {
            errors.push({ stop: stopId, error: 'legacy_unavailable' });
            return { stop: stopId, name: resolved?.name || 'Unknown', arrivals: [], error: 'legacy_unavailable' };
          }
        }

        const rawData = arrivalsRaw as any[];
        const arrivalEntries: any[] = Array.isArray(rawData[0]) ? rawData[0] : [];
        const allLineLabels = rawData[1] || [];

        const arrivals: Arrival[] = arrivalEntries.map((entry: any[]) => ({
          line: entry[0],
          destination: entry[1],
          minutes: entry[2] !== undefined ? entry[2] : null,
          next: entry[3] !== undefined ? entry[3] : null,
          color: '',
          active: true,
        }));

        // Filter by lines if provided
        const filtered = lines && lines.length > 0
          ? arrivals.filter((a: Arrival) => lines.includes(a.line))
          : arrivals;

        return {
          stop: stopId,
          name: resolved?.name || 'Unknown',
          arrivals: filtered,
          all_lines: allLineLabels,
        };
      } catch {
        errors.push({ stop: stopId, error: 'request_failed' });
        return { stop: stopId, name: 'Unknown', arrivals: [], error: 'request_failed' };
      }
    });

    const results = await withConcurrency(tasks, BATCH_CONCURRENCY);

    res.json({
      results,
      errors,
      elapsed_ms: Date.now() - start,
    });
  } catch (err) {
    res.status(500).json({ error: 'batch_arrivals_error', message: 'Batch arrivals failed', source: 'legacy_api', timestamp: new Date().toISOString() });
  }
});

// ─── POST /api/v1/batch/stops ──────────────────────────────────────

router.post('/stops', async (req: Request, res: Response) => {
  try {
    const { stops } = req.body as { stops?: number[] };

    if (!stops || !Array.isArray(stops) || stops.length === 0) {
      return res.status(400).json({
        error: 'invalid_params',
        message: 'Request body must contain a non-empty "stops" array',
        source: 'cache',
        timestamp: new Date().toISOString(),
      });
    }

    const results = await Promise.all(
      stops.map(async (stopId: number) => {
        const stop = await resolveStop(stopId);
        return stop
          ? { stopId: stop.stopId, name: stop.name, lat: stop.lat, lng: stop.lng, address: stop.address, sentido: stop.sentido, source: stop.source }
          : { stopId, error: 'not_found' };
      }),
    );

    res.json({ results, total: results.length });
  } catch (err) {
    res.status(500).json({ error: 'batch_stops_error', message: 'Batch stops lookup failed', source: 'cache', timestamp: new Date().toISOString() });
  }
});

// ─── POST /api/v1/batch/lines ──────────────────────────────────────

router.post('/lines', async (req: Request, res: Response) => {
  try {
    const { lines } = req.body as { lines?: string[] };

    if (!lines || !Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({
        error: 'invalid_params',
        message: 'Request body must contain a non-empty "lines" array',
        source: 'cache',
        timestamp: new Date().toISOString(),
      });
    }

    await buildLineIndex();

    const results = lines.map((lineId: string) => {
      const info = getLine(lineId);
      return info
        ? { id: info.id, name: info.name, color: info.color, text_color: info.text_color, destinations: info.destinations, stats: info.stats, has_schedule: info.has_schedule, active: info.active }
        : { id: lineId, error: 'not_found' };
    });

    res.json({ results, total: results.length });
  } catch (err) {
    res.status(500).json({ error: 'batch_lines_error', message: 'Batch lines lookup failed', source: 'cache', timestamp: new Date().toISOString() });
  }
});

export default router;
