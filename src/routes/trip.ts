import { Router, Request, Response } from 'express';
import { getStopById } from '../sources/openData';
import { getStopPositions, getCommonStops, getStopName, buildLineIndex, getLinesForStop, getLine, getLinePositionMap } from '../sources/lineIndex';
import { resolveStop } from '../utils/helpers';

const router = Router();

// ─── Trip option type ───────────────────────────────────────────────

interface TripOption {
  type: 'direct' | 'transfer';
  line: string;
  name: string;
  color: string;
  direction: string;
  stops: number;
  total_stops: number;
  duration_min: number;
  transfer_at?: { stopId: number; name: string };
  transfer_line?: string;
  transfer_direction?: string;
  transfer_stops?: number;
}

// ─── Trip planning algorithms ───────────────────────────────────────

/**
 * Find all direct (single-line) routes between two stops.
 * Handles same-direction forward trips, circular line wrap-around,
 * and same-line different-direction trips (ride to terminus, line continues).
 */
function findDirectRoutes(fromId: number, toId: number): TripOption[] {
  const options: TripOption[] = [];
  const fromLines = getLinesForStop(fromId);
  const toLines = getLinesForStop(toId);

  for (const lineId of fromLines) {
    if (!toLines.includes(lineId)) continue;
    const lineInfo = getLine(lineId);
    if (!lineInfo) continue;

    const dirs = Object.keys(lineInfo.directions);

    // ── Same-direction trips ──────────────────────────────────────
    for (const dir of dirs) {
      const positions = getLinePositionMap(lineId, dir);
      if (!positions) continue;
      const fromPos = positions.get(fromId);
      const toPos = positions.get(toId);
      if (fromPos === undefined || toPos === undefined) continue;

      if (toPos > fromPos) {
        // Forward trip within same direction
        const nStops = toPos - fromPos;
        options.push({
          type: 'direct',
          line: lineId,
          name: lineInfo.name,
          color: lineInfo.color,
          direction: lineInfo.directions[dir].destination,
          stops: nStops,
          total_stops: nStops,
          duration_min: Math.max(1, nStops * 2),
        });
      } else {
        // Check for circular line: first stop equals last stop
        const dirStops = lineInfo.directions[dir].stops;
        if (dirStops.length > 1 && dirStops[0] === dirStops[dirStops.length - 1]) {
          // Wrap-around distance: from → end → start → to
          const wrapStops = (dirStops.length - 1 - fromPos) + toPos;
          if (wrapStops > 0) {
            options.push({
              type: 'direct',
              line: lineId,
              name: lineInfo.name,
              color: lineInfo.color,
              direction: lineInfo.directions[dir].destination,
              stops: wrapStops,
              total_stops: wrapStops,
              duration_min: Math.max(1, wrapStops * 2),
            });
          }
        }
      }
    }

    // ── Same-line different-direction trips ───────────────────────
    // fromId in dirA, toId in dirB (dirA ≠ dirB), toId NOT in dirA
    if (dirs.length === 2) {
      const [dirA, dirB] = dirs;

      // Case: fromId in dirA, toId in dirB only
      {
        const posA = getLinePositionMap(lineId, dirA);
        const posB = getLinePositionMap(lineId, dirB);
        if (posA && posB) {
          const fromPosA = posA.get(fromId);
          const toPosB = posB.get(toId);
          const toPosA = posA.get(toId);
          if (fromPosA !== undefined && toPosB !== undefined && toPosA === undefined) {
            const leg1Stops = (lineInfo.directions[dirA].stops.length - 1) - fromPosA;
            const totalStops = leg1Stops + toPosB;
            options.push({
              type: 'direct',
              line: lineId,
              name: lineInfo.name,
              color: lineInfo.color,
              direction: lineInfo.directions[dirA].destination,
              stops: leg1Stops,
              total_stops: totalStops,
              duration_min: Math.max(1, totalStops * 2),
            });
          }
        }
      }

      // Case: fromId in dirB, toId in dirA only
      {
        const posB = getLinePositionMap(lineId, dirB);
        const posA = getLinePositionMap(lineId, dirA);
        if (posB && posA) {
          const fromPosB = posB.get(fromId);
          const toPosA = posA.get(toId);
          const toPosB = posB.get(toId);
          if (fromPosB !== undefined && toPosA !== undefined && toPosB === undefined) {
            const leg1Stops = (lineInfo.directions[dirB].stops.length - 1) - fromPosB;
            const totalStops = leg1Stops + toPosA;
            options.push({
              type: 'direct',
              line: lineId,
              name: lineInfo.name,
              color: lineInfo.color,
              direction: lineInfo.directions[dirB].destination,
              stops: leg1Stops,
              total_stops: totalStops,
              duration_min: Math.max(1, totalStops * 2),
            });
          }
        }
      }
    }
  }

  return options;
}

/**
 * Find all transfer (two-line) routes between two stops.
 * Uses precomputed line-stop position indices and common-stop sets.
 */
function findTransferRoutes(fromId: number, toId: number): TripOption[] {
  const options: TripOption[] = [];
  const fromLines = getLinesForStop(fromId);
  const toLines = getLinesForStop(toId);

  for (const lineA of fromLines) {
    const lineAInfo = getLine(lineA);
    if (!lineAInfo) continue;

    for (const lineB of toLines) {
      if (lineA === lineB) continue;
      const lineBInfo = getLine(lineB);
      if (!lineBInfo) continue;

      const commonStops = getCommonStops(lineA, lineB);

      for (const commonStopId of commonStops) {
        const dirsA = Object.keys(lineAInfo.directions);
        const dirsB = Object.keys(lineBInfo.directions);

        for (const dirA of dirsA) {
          const posA = getLinePositionMap(lineA, dirA);
          if (!posA) continue;
          const fromPos = posA.get(fromId);
          const commonPosA = posA.get(commonStopId);
          if (fromPos === undefined || commonPosA === undefined || commonPosA <= fromPos) continue;

          for (const dirB of dirsB) {
            const posB = getLinePositionMap(lineB, dirB);
            if (!posB) continue;
            const commonPosB = posB.get(commonStopId);
            const toPos = posB.get(toId);
            if (commonPosB === undefined || toPos === undefined || toPos <= commonPosB) continue;

            const leg1Stops = commonPosA - fromPos;
            const leg2Stops = toPos - commonPosB;
            const totalStops = leg1Stops + leg2Stops;
            const duration = totalStops * 2 + 5;

            const transferName = getStopName(commonStopId) || 'Unknown';

            options.push({
              type: 'transfer',
              line: lineA,
              name: lineAInfo.name,
              color: lineAInfo.color,
              direction: lineAInfo.directions[dirA].destination,
              stops: leg1Stops,
              total_stops: totalStops,
              duration_min: Math.max(1, duration),
              transfer_at: { stopId: commonStopId, name: transferName },
              transfer_line: lineB,
              transfer_direction: lineBInfo.directions[dirB].destination,
              transfer_stops: leg2Stops,
            });
          }
        }
      }
    }
  }

  return options;
}

// ─── GET /api/v1/trip?from=X&to=Y ──────────────────────────────────
// Plan trip between two stops: direct routes and transfer routes

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

    // ── Edge case: same stop ──────────────────────────────────────
    if (fromId === toId) {
      return res.status(200).json({
        from: { stopId: fromId, name: getStopName(fromId) || 'Unknown' },
        to: { stopId: toId, name: getStopName(toId) || 'Unknown' },
        options: [],
        summary: {
          total_options: 0,
          direct_count: 0,
          transfer_count: 0,
          best_duration_min: null,
          message: 'Origin and destination are the same',
        },
      });
    }

    await buildLineIndex();

    const fromStop = await resolveStop(fromId);
    const toStop = await resolveStop(toId);

    if (!fromStop) {
      return res.status(404).json({
        error: 'stop_not_found',
        message: `Origin stop ${fromId} not found`,
        source: 'cache',
        timestamp: new Date().toISOString(),
      });
    }
    if (!toStop) {
      return res.status(404).json({
        error: 'stop_not_found',
        message: `Destination stop ${toId} not found`,
        source: 'cache',
        timestamp: new Date().toISOString(),
      });
    }

    // ── Compute all routes (both types always) ────────────────────
    const directOptions = findDirectRoutes(fromId, toId);
    const transferOptions = findTransferRoutes(fromId, toId);
    let allOptions = [...directOptions, ...transferOptions];

    // Deduplicate by (type, line, total_stops, transfer_at.stopId)
    const seen = new Set<string>();
    allOptions = allOptions.filter(o => {
      const key = `${o.type}|${o.line}|${o.total_stops}|${o.transfer_at?.stopId ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Rank: direct before transfer, fewer stops, shorter duration, alphabetical
    allOptions.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'direct' ? -1 : 1;
      if (a.total_stops !== b.total_stops) return a.total_stops - b.total_stops;
      if (a.duration_min !== b.duration_min) return a.duration_min - b.duration_min;
      return a.line.localeCompare(b.line);
    });

    // ── Limit to top 10 ───────────────────────────────────────────
    const topOptions = allOptions.slice(0, 10);

    // ── No results ────────────────────────────────────────────────
    if (topOptions.length === 0) {
      return res.status(200).json({
        from: { stopId: fromId, name: fromStop.name },
        to: { stopId: toId, name: toStop.name },
        options: [],
        summary: {
          total_options: 0,
          direct_count: 0,
          transfer_count: 0,
          best_duration_min: null,
          message: 'No route found',
        },
      });
    }

    const bestDuration = topOptions[0].duration_min;
    const directCount = topOptions.filter(o => o.type === 'direct').length;
    const transferCount = topOptions.filter(o => o.type === 'transfer').length;

    res.json({
      from: { stopId: fromId, name: fromStop.name },
      to: { stopId: toId, name: toStop.name },
      options: topOptions,
      summary: {
        total_options: topOptions.length,
        direct_count: directCount,
        transfer_count: transferCount,
        best_duration_min: bestDuration,
        message: `${topOptions.length} route(s) found`,
      },
    });
  } catch (err) {
    console.error('[trip] Error:', err);
    res.status(500).json({
      error: 'trip_error',
      message: 'Failed to plan trip',
      source: 'cache',
      timestamp: new Date().toISOString(),
    });
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
