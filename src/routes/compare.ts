import { Router, Request, Response } from 'express';
import * as lineIndex from '../sources/lineIndex';

const router = Router();

// ─── POST /api/v1/compare/lines ─────────────────────────────────────

router.post('/lines', async (req: Request, res: Response) => {
  try {
    const { lines } = req.body as { lines?: string[] };

    if (!lines || !Array.isArray(lines) || lines.length < 2) {
      return res.status(400).json({
        error: 'invalid_params',
        message: 'Request body must contain a "lines" array with at least 2 line IDs',
        source: 'cache',
        timestamp: new Date().toISOString(),
      });
    }

    await lineIndex.buildLineIndex();

    // Validate all lines exist — 404 if any is missing
    const missingLines: string[] = [];
    for (const lineId of lines) {
      if (!lineIndex.getLine(lineId)) {
        missingLines.push(lineId);
      }
    }
    if (missingLines.length > 0) {
      return res.status(404).json({
        error: 'line_not_found',
        message: `Las siguientes líneas no existen: ${missingLines.join(', ')}`,
        source: 'cache',
        timestamp: new Date().toISOString(),
      });
    }

    // Build stop sets for each line (union of both directions)
    const lineStopSets: Map<string, Set<number>> = new Map();
    for (const lineId of lines) {
      const stops1 = new Set(lineIndex.getLineStops(lineId, '1'));
      const stops2 = new Set(lineIndex.getLineStops(lineId, '2'));
      const allStops = new Set<number>([...stops1, ...stops2]);
      lineStopSets.set(lineId, allStops);
    }

    // Compute common_stops_with for each pair
    const lineResults = lines.map((lineId) => {
      const myStops = lineStopSets.get(lineId) || new Set<number>();
      const commonWith: Record<string, number> = {};

      for (const otherId of lines) {
        if (otherId === lineId) continue;
        const otherStops = lineStopSets.get(otherId) || new Set<number>();
        let count = 0;
        for (const s of myStops) {
          if (otherStops.has(s)) count++;
        }
        commonWith[otherId] = count;
      }

      const info = lineIndex.getLine(lineId);
      return {
        id: lineId,
        stops: info ? info.stats.stops_total : 0,
        common_stops_with: commonWith,
      };
    });

    // Compute overall common stops (intersection of all lines)
    let commonStops: number[] = [];
    if (lines.length >= 2) {
      const firstSet = lineStopSets.get(lines[0]);
      if (firstSet) {
        commonStops = [...firstSet].filter((sid) =>
          lines.slice(1).every((lineId) => lineStopSets.get(lineId)?.has(sid)),
        );
      }
    }

    res.json({
      lines: lineResults,
      common_stops: commonStops,
      total_common: commonStops.length,
    });
  } catch (err) {
    res.status(500).json({
      error: 'compare_lines_error',
      message: 'Line comparison failed',
      source: 'cache',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
