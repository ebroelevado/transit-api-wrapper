import { Router, Request, Response } from 'express';
import { VERSION } from '../config';

const router = Router();

// ─── OPTIONS /api/v1 ────────────────────────────────────────────────
// Discovery of top-level endpoints

/**
 * @swagger
 * /api/v1:
 *   options:
 *     tags: [DX]
 *     summary: Descubrimiento de endpoints disponibles (Link headers)
 *     responses:
 *       204:
 *         description: No Content
 */
router.options('/api/v1', (_req: Request, res: Response) => {
  res.setHeader('Allow', 'GET, POST, HEAD, OPTIONS');
  res.setHeader('Link', [
    '</api/v1/lines>; rel="lines"',
    '</api/v1/stops>; rel="stops"',
    '</api/v1/discover>; rel="discover"',
    '</api/v1/fares>; rel="fares"',
    '</api/v1/trip>; rel="trip-planner"',
    '</api/v1/health>; rel="health"',
    '</api/v1/now>; rel="server-time"',
    '</api/v1/alerts>; rel="alerts"',
    '</api/v1/map/stops>; rel="map-stops"',
    '</api/v1/map/lines>; rel="map-lines"',
    '</api/v1/schedule/lines>; rel="schedules"',
  ].join(', '));
  res.setHeader('X-API-Version', VERSION);
  res.status(204).end();
});

// ─── OPTIONS /api/v1/stops/:stop ────────────────────────────────────
// Available actions for a specific stop

/**
 * @swagger
 * /api/v1/stops/{stop}:
 *   options:
 *     tags: [DX]
 *     summary: Acciones disponibles sobre esta parada
 *     parameters:
 *       - in: path
 *         name: stop
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       204:
 *         description: No Content
 */
router.options('/api/v1/stops/:stop', (_req: Request, res: Response) => {
  const stop = _req.params.stop;
  res.setHeader('Allow', 'GET, OPTIONS');
  res.setHeader('Link', [
    `</api/v1/stops/${stop}>; rel="self"`,
    `</api/v1/stops/${stop}/arrivals>; rel="arrivals"`,
    `</api/v1/stops/${stop}/next>; rel="next-bus"`,
    `</api/v1/stops/${stop}/etd>; rel="etd"`,
    `</api/v1/stops/${stop}/connections>; rel="connections"`,
  ].join(', '));
  res.setHeader('X-API-Version', VERSION);
  res.status(204).end();
});

export default router;
