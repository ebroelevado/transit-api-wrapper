import { Router, Request, Response } from 'express';
import { getStops, getStopById } from '../sources/openData';
import { getLines, getLine, getLinesForStop, getLineStops, buildLineIndex } from '../sources/lineIndex';
import { Stop, LineInfo } from '../types';
import stopsMinRaw from '../../data/stops.min.json';

const router = Router();

// ─── Helpers ────────────────────────────────────────────────────────

/** Unified stop lookup: Open Data first, then stops.min.json fallback. */
async function resolveStop(stopId: number): Promise<Stop | null> {
  const fromOpen = await getStopById(stopId);
  if (fromOpen) return fromOpen;

  const min = stopsMinRaw as unknown as Record<string, [number, number, number, string]>;
  const entry = min[String(stopId)];
  if (!entry) return null;

  return {
    stopId: entry[0],
    lat: entry[1],
    lng: entry[2],
    name: entry[3],
    address: null,
    sentido: null,
    lines: [],
    source: 'stops_min',
  };
}

// ─── GET /api/v1/trip?from=X&to=Y ──────────────────────────────────
// Find direct/transfer routes by intersecting line stops arrays

/**
 * @swagger
 * /api/v1/trip:
 *   get:
 *     tags: [Trip]
 *     summary: Planificar viaje entre dos paradas (directo y transbordo)
 *     parameters:
 *       - in: query
 *         name: from
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: to
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
 *               properties:
 *                 from:
 *                   type: object
 *                 to:
 *                   type: object
 *                 options:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       type:
 *                         type: string
 *                         enum: [direct, transfer]
 *                       line:
 *                         type: string
 *                       color:
 *                         type: string
 *                       stops:
 *                         type: integer
 *                       direction:
 *                         type: string
 *                       duration_min:
 *                         type: integer
 *                         nullable: true
 */
router.get('/trip', async (req: Request, res: Response) => {
  try {
    const fromId = parseInt(req.query.from as string, 10);
    const toId = parseInt(req.query.to as string, 10);

    if (isNaN(fromId) || isNaN(toId)) {
      return res.status(400).json({
        error: 'invalid_params',
        message: 'Both "from" and "to" query parameters (stop IDs) are required',
        source: 'cache',
        timestamp: new Date().toISOString(),
      });
    }

    await buildLineIndex();

    const fromStop = await resolveStop(fromId);
    const toStop = await resolveStop(toId);

    if (!fromStop) {
      return res.status(404).json({ error: 'stop_not_found', message: `Origin stop ${fromId} not found`, source: 'cache', timestamp: new Date().toISOString() });
    }
    if (!toStop) {
      return res.status(404).json({ error: 'stop_not_found', message: `Destination stop ${toId} not found`, source: 'cache', timestamp: new Date().toISOString() });
    }

    const fromLines = getLinesForStop(fromId);
    const toLines = getLinesForStop(toId);

    interface TripOption {
      type: 'direct' | 'transfer';
      duration_min: number | null;
      line: string;
      color: string;
      stops: number;
      direction: string;
      transfer_at?: { stopId: number; name: string };
      transfer_line?: string;
    }

    const options: TripOption[] = [];

    // ── Direct routes ─────────────────────────────────────────────────
    for (const lineId of fromLines) {
      const lineInfo = getLine(lineId);
      if (!lineInfo) continue;

      for (const dir of Object.keys(lineInfo.directions)) {
        const stops = lineInfo.directions[dir].stops;
        const fromIdx = stops.indexOf(fromId);
        const toIdx = stops.indexOf(toId);

        if (fromIdx !== -1 && toIdx !== -1 && toIdx > fromIdx) {
          options.push({
            type: 'direct',
            duration_min: null,
            line: lineId,
            color: lineInfo.color,
            stops: toIdx - fromIdx,
            direction: lineInfo.directions[dir].destination,
          });
        }
      }
    }

    // ── Transfer routes ───────────────────────────────────────────────
    if (options.length === 0) {
      for (const fromLineId of fromLines) {
        const fromLineInfo = getLine(fromLineId);
        if (!fromLineInfo) continue;

        for (const toLineId of toLines) {
          if (fromLineId === toLineId) continue;
          const toLineInfo = getLine(toLineId);
          if (!toLineInfo) continue;

          // Find intersection stops between the two lines' stop sets
          const fromStopsAll = new Set<number>();
          for (const dir of Object.values(fromLineInfo.directions)) {
            for (const s of dir.stops) fromStopsAll.add(s);
          }

          const toStopsAll = new Set<number>();
          for (const dir of Object.values(toLineInfo.directions)) {
            for (const s of dir.stops) toStopsAll.add(s);
          }

          for (const commonStopId of fromStopsAll) {
            if (!toStopsAll.has(commonStopId)) continue;

            // Check that from stop appears before common stop in from line
            // and common stop appears before to stop in to line
            for (const fromDir of Object.keys(fromLineInfo.directions)) {
              const fromStops = fromLineInfo.directions[fromDir].stops;
              const fromIdx = fromStops.indexOf(fromId);
              const commonIdxFrom = fromStops.indexOf(commonStopId);
              if (fromIdx === -1 || commonIdxFrom === -1 || commonIdxFrom <= fromIdx) continue;

              for (const toDir of Object.keys(toLineInfo.directions)) {
                const toStops = toLineInfo.directions[toDir].stops;
                const commonIdxTo = toStops.indexOf(commonStopId);
                const toIdx = toStops.indexOf(toId);
                if (commonIdxTo === -1 || toIdx === -1 || toIdx <= commonIdxTo) continue;

                const transferStop = await resolveStop(commonStopId);
                options.push({
                  type: 'transfer',
                  duration_min: null,
                  line: fromLineId,
                  color: fromLineInfo.color,
                  stops: commonIdxFrom - fromIdx,
                  direction: fromLineInfo.directions[fromDir].destination,
                  transfer_at: transferStop
                    ? { stopId: commonStopId, name: transferStop.name }
                    : { stopId: commonStopId, name: 'Unknown' },
                  transfer_line: toLineId,
                });
              }
            }
          }
        }
      }
    }

    res.json({
      from: { stopId: fromId, name: fromStop.name },
      to: { stopId: toId, name: toStop.name },
      options,
    });
  } catch (err) {
    res.status(500).json({ error: 'trip_error', message: 'Failed to plan trip', source: 'cache', timestamp: new Date().toISOString() });
  }
});

// ─── GET /api/v1/stops/:stop/connections ───────────────────────────
// All reachable stops from this stop (without transfer)

/**
 * @swagger
 * /api/v1/stops/{stop}/connections:
 *   get:
 *     tags: [Trip]
 *     summary: Paradas alcanzables sin transbordo desde esta parada
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
router.get('/stops/:stop/connections', async (req: Request, res: Response) => {
  try {
    const stopId = parseInt(req.params.stop as string, 10);
    if (isNaN(stopId)) {
      return res.status(400).json({ error: 'invalid_stop', message: 'Stop ID must be a number', source: 'cache', timestamp: new Date().toISOString() });
    }

    await buildLineIndex();

    const originStop = await resolveStop(stopId);
    if (!originStop) {
      return res.status(404).json({ error: 'stop_not_found', message: `Stop ${stopId} not found`, source: 'cache', timestamp: new Date().toISOString() });
    }

    const lines = getLinesForStop(stopId);

    interface ConnectionEntry {
      stopId: number;
      name: string;
      via_line: string;
      direction: string;
    }

    const connections: Map<number, ConnectionEntry[]> = new Map();

    for (const lineId of lines) {
      const lineInfo = getLine(lineId);
      if (!lineInfo) continue;

      for (const dir of Object.keys(lineInfo.directions)) {
        const stops = lineInfo.directions[dir].stops;
        const idx = stops.indexOf(stopId);
        if (idx === -1) continue;

        // All stops after this one in the same direction
        for (let i = idx + 1; i < stops.length; i++) {
          const targetId = stops[i];
          if (!connections.has(targetId)) {
            connections.set(targetId, []);
          }
          const resolved = await resolveStop(targetId);
          connections.get(targetId)!.push({
            stopId: targetId,
            name: resolved?.name || 'Unknown',
            via_line: lineId,
            direction: lineInfo.directions[dir].destination,
          });
        }
      }
    }

    const result: { stop: { stopId: number; name: string }; reachable_stops: any[] } = {
      stop: { stopId, name: originStop.name },
      reachable_stops: [],
    };

    for (const [sid, entries] of connections) {
      result.reachable_stops.push({
        stopId: sid,
        name: entries[0]?.name || 'Unknown',
        via_lines: entries.map((e) => ({ line: e.via_line, direction: e.direction })),
      });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'connections_error', message: 'Failed to get connections', source: 'cache', timestamp: new Date().toISOString() });
  }
});

export default router;
