import { Router, Request, Response } from 'express';
import * as lineIndex from '../sources/lineIndex';

const router = Router();

// ─── POST /api/v1/compare/lines ─────────────────────────────────────
// Body: { lines: string[] }
// Returns side-by-side comparison and common stops

/**
 * @swagger
 * /api/v1/compare/lines:
 *   post:
 *     tags: [Compare]
 *     summary: Comparar líneas lado a lado con paradas comunes
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               lines:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */
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

    // Build stop sets for each line (union of both directions)
    const lineStopSets: Map<string, Set<number>> = new Map();
    for (const lineId of lines) {
      const stops1 = new Set(lineIndex.getLineStops(lineId, '1'));
      const stops2 = new Set(lineIndex.getLineStops(lineId, '2'));
      // Union of both directions
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
