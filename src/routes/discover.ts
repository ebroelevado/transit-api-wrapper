import { Router, Request, Response } from 'express';
import { VERSION } from '../config';
import * as openData from '../sources/openData';
import * as lineIndex from '../sources/lineIndex';

const router = Router();

/**
 * @swagger
 * /api/v1/discover:
 *   get:
 *     tags: [Core]
 *     summary: Información de descubrimiento para apps cliente
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 app:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: string
 *                     version:
 *                       type: string
 *                 lines:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: number
 *                     url:
 *                       type: string
 *                 stops:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: number
 *                     search_url:
 *                       type: string
 *                     nearby_url:
 *                       type: string
 *                 fares:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: number
 *                     url:
 *                       type: string
 *                 endpoints:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: number
 *                 status:
 *                   type: object
 *       500:
 *         description: Internal error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */
router.get('/discover', async (_req: Request, res: Response) => {
  try {
    const odCount = await openData.getStopCount();
    const lines = lineIndex.getLines();
    res.json({
      app: { name: 'Transit API Wrapper', version: VERSION },
      lines: { total: lines.length, url: '/api/v1/lines' },
      stops: {
        total: odCount,
        search_url: '/api/v1/stops?q={query}',
        nearby_url: '/api/v1/stops/nearby?lat={lat}&lng={lng}',
      },
      fares: { total: 7, url: '/api/v1/fares' },
      endpoints: { total: 37 },
      status: { legacy_api: lines.length > 0 ? 'ok' : 'unavailable', open_data: odCount > 0 ? 'ok' : 'unavailable' },
    });
  } catch (err: any) {
    console.error('[discover] Error:', err?.message || err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal_error', message: err?.message || 'Unknown error', source: 'internal', timestamp: new Date().toISOString() });
    }
  }
});

/**
 * @swagger
 * /api/v1/discover:
 *   head:
 *     tags: [Core]
 *     summary: Cabeceras de descubrimiento (sin body)
 *     responses:
 *       200:
 *         description: OK
 *         headers:
 *           X-API-Version:
 *             schema:
 *               type: string
 *             description: API version
 *           X-Cache-Stops:
 *             schema:
 *               type: string
 *             description: Number of stops cached
 *           X-Cache-Lines:
 *             schema:
 *               type: string
 *             description: Number of lines cached
 *           X-Legacy-Status:
 *             schema:
 *               type: string
 *             description: Legacy API status
 *           X-OpenData-Status:
 *             schema:
 *               type: string
 *             description: Open Data status
 *       500:
 *         description: Internal error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */
router.head('/discover', async (_req: Request, res: Response) => {
  try {
    const odCount = await openData.getStopCount();
    const lines = lineIndex.getLines();
    res.setHeader('X-API-Version', VERSION);
    res.setHeader('X-Cache-Stops', String(odCount));
    res.setHeader('X-Cache-Lines', String(lines.length));
    const odStatus = odCount > 0 ? 'ok' : 'unavailable';
    const lineStatus = lines.length > 0 ? 'ok' : 'unavailable';
    res.setHeader('X-Legacy-Status', lineStatus);
    res.setHeader('X-OpenData-Status', odStatus);
    res.status(200).end();
  } catch (err: any) {
    console.error('[discover] Error:', err?.message || err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal_error', message: err?.message || 'Unknown error', source: 'internal', timestamp: new Date().toISOString() });
    }
  }
});

export default router;
