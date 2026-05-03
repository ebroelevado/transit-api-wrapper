import { Router, Request, Response } from 'express';
import * as lineIndex from '../sources/lineIndex';
import * as openData from '../sources/openData';
import { toScheduleId } from '../utils/lineMapping';
import { resolveStop } from '../utils/helpers';

const router = Router();

/**
 * @swagger
 * /api/v1/lines:
 *   get:
 *     tags: [Core]
 *     summary: Catálogo completo de líneas de autobús
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 lines:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       name:
 *                         type: string
 *                       color:
 *                         type: string
 *                       text_color:
 *                         type: string
 *                       destinations:
 *                         type: array
 *                         items:
 *                           type: string
 *                       stops:
 *                         type: number
 *                       has_schedule:
 *                         type: boolean
 *                       active:
 *                         type: boolean
 *                 total:
 *                   type: number
 *                 updated:
 *                   type: string
 *                   format: date-time
 *             example:
 *               lines:
 *                 - id: "1"
 *                   name: "Pcta. Juan Carlos I - Adarzo"
 *                   color: "#E30613"
 *                   text_color: "#FFFFFF"
 *                   destinations: ["Adarzo", "Pcta. Juan Carlos I"]
 *                   stops: 38
 *                   has_schedule: true
 *                   active: true
 *                 - id: "LC"
 *                   name: "Línea Centro"
 *                   color: "#00A650"
 *                   text_color: "#FFFFFF"
 *                   destinations: ["Estaciones", "Estaciones"]
 *                   stops: 12
 *                   has_schedule: true
 *                   active: true
 *                 - id: "N1"
 *                   name: "Búho 1"
 *                   color: "#1D1D1B"
 *                   text_color: "#FFFFFF"
 *                   destinations: ["El Sardinero", "Corban"]
 *                   stops: 42
 *                   has_schedule: false
 *                   active: true
 *               total: 3
 *               updated: "2025-01-01T00:00:00.000Z"
 *       500:
 *         description: Internal error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */
router.get('/lines', async (_req: Request, res: Response) => {
  try {
    await lineIndex.buildLineIndex();
    const lines = lineIndex.getLines();
    res.json({
      lines: lines.map(l => ({
        id: l.id,
        name: l.name,
        color: l.color,
        text_color: l.text_color,
        destinations: Object.values(l.destinations),
        stops: l.stats.stops_total,
        has_schedule: l.has_schedule,
        active: l.active,
      })),
      total: lines.length,
      updated: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[lines] Error:', err?.message || err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal_error', message: err?.message || 'Unknown error', source: 'internal', timestamp: new Date().toISOString() });
    }
  }
});

/**
 * @swagger
 * /api/v1/lines/{line}:
 *   get:
 *     tags: [Core]
 *     summary: Detalle de una línea específica
 *     parameters:
 *       - in: path
 *         name: line
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de línea (ej: LC, 1, N1)
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 name:
 *                   type: string
 *                 color:
 *                   type: string
 *                 text_color:
 *                   type: string
 *                 schedule_id:
 *                   type: string
 *                   nullable: true
 *                 destinations:
 *                   type: object
 *                   properties:
 *                     "1":
 *                       type: string
 *                     "2":
 *                       type: string
 *                 stats:
 *                   type: object
 *                   properties:
 *                     stops_total:
 *                       type: number
 *                     stops_direction_1:
 *                       type: number
 *                     stops_direction_2:
 *                       type: number
 *                 has_schedule:
 *                   type: boolean
 *                 active:
 *                   type: boolean
 *       404:
 *         description: Line not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: line_not_found
 *                 message:
 *                   type: string
 *       500:
 *         description: Internal error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */
router.get('/lines/:line', async (req: Request, res: Response) => {
  try {
    await lineIndex.buildLineIndex();
    const line = lineIndex.getLine(req.params.line as string);
    if (!line) {
      return res.status(404).json({ error: 'line_not_found', message: `La línea '${req.params.line}' no existe` });
    }
    res.json({
      id: line.id,
      name: line.name,
      color: line.color,
      text_color: line.text_color,
      schedule_id: toScheduleId(line.id) || null,
      destinations: line.destinations,
      stats: line.stats,
      has_schedule: line.has_schedule,
      active: line.active,
    });
  } catch (err: any) {
    console.error('[lines] Error:', err?.message || err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal_error', message: err?.message || 'Unknown error', source: 'internal', timestamp: new Date().toISOString() });
    }
  }
});

/**
 * @swagger
 * /api/v1/lines/{line}/route:
 *   get:
 *     tags: [Core]
 *     summary: Ruta completa de una línea con coordenadas GPS
 *     parameters:
 *       - in: path
 *         name: line
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de línea
 *       - in: query
 *         name: direction
 *         required: false
 *         schema:
 *           type: string
 *           default: all
 *         description: "1, 2, o all (default)"
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
 *                 color:
 *                   type: string
 *                 directions:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       destination:
 *                         type: string
 *                       stops:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             stopId:
 *                               type: number
 *                             name:
 *                               type: string
 *                             lat:
 *                               type: number
 *                             lng:
 *                               type: number
 *                             sentido:
 *                               type: string
 *                               nullable: true
 *                             lines:
 *                               type: array
 *                               items:
 *                                 type: string
 *                             source:
 *                               type: string
 *       404:
 *         description: Line not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: line_not_found
 *       500:
 *         description: Internal error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */
router.get('/lines/:line/route', async (req: Request, res: Response) => {
  try {
    await lineIndex.buildLineIndex();
    const line = lineIndex.getLine(req.params.line as string);
    if (!line) {
      return res.status(404).json({ error: 'line_not_found', message: `La línea '${req.params.line}' no existe` });
    }

    const dir = (req.query.direction as string) || 'all';
    const directions: any[] = [];

    for (const [dId, dData] of Object.entries(line.directions)) {
      if (dir !== 'all' && dId !== dir) continue;
      const stops = await Promise.all(dData.stops.map(async (sid) => {
        const odStop = await openData.getStopById(sid);
        if (odStop) return odStop;
        const fallback = await resolveStop(sid);
        if (fallback) return { ...fallback, lines: lineIndex.getLinesForStop(sid) };
        return { stopId: sid, name: `Parada ${sid}`, lat: null, lng: null, address: null, sentido: null, lines: [], source: 'stops_min' };
      }));
      directions.push({ id: dId, destination: dData.destination, stops });
    }

    res.json({ line: line.id, color: line.color, directions });
  } catch (err: any) {
    console.error('[lines] Error:', err?.message || err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal_error', message: err?.message || 'Unknown error', source: 'internal', timestamp: new Date().toISOString() });
    }
  }
});

// Intersect endpoint (shared with compare.ts category but logically here)
/**
 * @swagger
 * /api/v1/lines/{lineA}/intersect/{lineB}:
 *   get:
 *     tags: [Compare]
 *     summary: Paradas comunes entre dos líneas
 *     parameters:
 *       - in: path
 *         name: lineA
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la primera línea
 *       - in: path
 *         name: lineB
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la segunda línea
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 line_a:
 *                   type: string
 *                 line_b:
 *                   type: string
 *                 common_stops:
 *                   type: array
 *                   items:
 *                     type: number
 *                 total:
 *                   type: number
 *       500:
 *         description: Internal error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */
router.get('/lines/:lineA/intersect/:lineB', async (req: Request, res: Response) => {
  try {
    const a = req.params.lineA as string;
    const b = req.params.lineB as string;

    await lineIndex.buildLineIndex();

    // Validate both lines exist
    const lineA = lineIndex.getLine(a);
    const lineB = lineIndex.getLine(b);
    if (!lineA) {
      return res.status(404).json({ error: 'line_not_found', message: `La línea '${a}' no existe` });
    }
    if (!lineB) {
      return res.status(404).json({ error: 'line_not_found', message: `La línea '${b}' no existe` });
    }

    const stopsA = new Set(lineIndex.getLineStops(a, '1').concat(lineIndex.getLineStops(a, '2')));
    const stopsB = lineIndex.getLineStops(b, '1').concat(lineIndex.getLineStops(b, '2'));
    const common = stopsB.filter(s => stopsA.has(s));
    res.json({ line_a: a, line_b: b, common_stops: common, total: common.length });
  } catch (err: any) {
    console.error('[lines] Error:', err?.message || err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal_error', message: err?.message || 'Unknown error', source: 'internal', timestamp: new Date().toISOString() });
    }
  }
});

export default router;
