import { Router, Request, Response } from 'express';
import { getStops, getStopById } from '../sources/openData';
import { getLines, getLine, getLineStops, buildLineIndex } from '../sources/lineIndex';
import { Stop } from '../types';
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

// ─── GET /api/v1/map/stops ─────────────────────────────────────────
// Compact format: { stops:[[stopId,lat,lng,name],...], total, source:'open_data' }

/**
 * @swagger
 * /api/v1/map/stops:
 *   get:
 *     tags: [Map]
 *     summary: 462 paradas en formato compacto [id,lat,lng,name]
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */
router.get('/stops', async (_req: Request, res: Response) => {
  try {
    const stops = await getStops();
    const compact = stops.map((s) => [s.stopId, s.lat, s.lng, s.name]);
    res.json({ stops: compact, total: stops.length, source: 'open_data' });
  } catch (err) {
    res.status(500).json({ error: 'map_stops_error', message: 'Failed to fetch stops', source: 'open_data', timestamp: new Date().toISOString() });
  }
});

// ─── GET /api/v1/map/lines/:line ───────────────────────────────────
// GeoJSON FeatureCollection with LineString per direction
// Query: ?direction=all (default) | 1 | 2

router.get('/lines/:line', async (req: Request, res: Response) => {
  try {
    await buildLineIndex();
    const lineInfo = getLine(req.params.line as string);
    if (!lineInfo) {
      return res.status(404).json({ error: 'line_not_found', message: `La línea '${req.params.line}' no existe`, source: 'cache', timestamp: new Date().toISOString() });
    }

    const direction = (req.query.direction as string) || 'all';

    const features: any[] = [];

    const buildFeature = async (dir: string, stops: number[], destination: string) => {
      const coordinates: [number, number][] = [];
      for (const sid of stops) {
        const stop = await resolveStop(sid);
        if (stop) {
          coordinates.push([stop.lng, stop.lat]);
        }
      }
      if (coordinates.length > 0) {
        features.push({
          type: 'Feature',
          properties: {
            line: lineInfo.id,
            direction: dir,
            destination,
            color: lineInfo.color,
          },
          geometry: {
            type: 'LineString',
            coordinates,
          },
        });
      }
    };

    if (direction === 'all' || direction === '1') {
      const dir1 = lineInfo.directions['1'];
      if (dir1) await buildFeature('1', dir1.stops, dir1.destination);
    }

    if (direction === 'all' || direction === '2') {
      const dir2 = lineInfo.directions['2'];
      if (dir2) await buildFeature('2', dir2.stops, dir2.destination);
    }

    res.json({ type: 'FeatureCollection', features });
  } catch (err) {
    res.status(500).json({ error: 'map_lines_error', message: 'Failed to build GeoJSON', source: 'cache', timestamp: new Date().toISOString() });
  }
});

// ─── GET /api/v1/map/lines ─────────────────────────────────────────
// All lines as GeoJSON

router.get('/lines', async (_req: Request, res: Response) => {
  try {
    await buildLineIndex();
    const lines = getLines();

    const features: any[] = [];

    for (const line of lines) {
      for (const dir of Object.keys(line.directions)) {
        const dirData = line.directions[dir];
        const coordinates: [number, number][] = [];
        for (const sid of dirData.stops) {
          const stop = await resolveStop(sid);
          if (stop) {
            coordinates.push([stop.lng, stop.lat]);
          }
        }
        if (coordinates.length > 0) {
          features.push({
            type: 'Feature',
            properties: {
              line: line.id,
              direction: dir,
              destination: dirData.destination,
              color: line.color,
            },
            geometry: {
              type: 'LineString',
              coordinates,
            },
          });
        }
      }
    }

    res.json({ type: 'FeatureCollection', features });
  } catch (err) {
    res.status(500).json({ error: 'map_lines_error', message: 'Failed to build GeoJSON', source: 'cache', timestamp: new Date().toISOString() });
  }
});

export default router;
