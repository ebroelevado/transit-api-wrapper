import { Router, Request, Response } from 'express';
import { VERSION } from '../config';
import * as openData from '../sources/openData';
import * as legacyApi from '../sources/legacyApi';
import * as lineIndex from '../sources/lineIndex';

const router = Router();
const startTime = Date.now();

/**
 * @swagger
 * /api/v1/health:
 *   get:
 *     tags: [Core]
 *     summary: Health check del wrapper y fuentes de datos
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [ok, degraded]
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 uptime_seconds:
 *                   type: number
 *                 sources:
 *                   type: object
 *                   properties:
 *                     open_data:
 *                       type: object
 *                       properties:
 *                         status:
 *                           type: string
 *                           enum: [ok, unavailable]
 *                         stops_cached:
 *                           type: number
 *                         age_seconds:
 *                           type: number
 *                     legacy_api:
 *                       type: object
 *                       properties:
 *                         status:
 *                           type: string
 *                           enum: [ok, unavailable]
 *                         latency_ms:
 *                           type: number
 *                           nullable: true
 *                 cache:
 *                   type: object
 *                   properties:
 *                     stops:
 *                       type: object
 *                       properties:
 *                         loaded:
 *                           type: boolean
 *                         count:
 *                           type: number
 *                         source:
 *                           type: string
 *                     lines:
 *                       type: object
 *                       properties:
 *                         loaded:
 *                           type: boolean
 *                         count:
 *                           type: number
 *                 version:
 *                   type: string
 *       503:
 *         description: Degraded — some sources unavailable
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       500:
 *         description: Internal error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */
router.get('/health', async (_req: Request, res: Response) => {
  try {
    const odCount = await openData.getStopCount();
    const legacy = await legacyApi.getHealth();
    const lines = lineIndex.getLines();

    const ok = legacy && !('error' in legacy);
    const status = ok && odCount > 0 && lines.length > 0 ? 'ok' : 'degraded';
    const httpCode = status === 'ok' ? 200 : 503;

    res.status(httpCode).json({
      status,
      timestamp: new Date().toISOString(),
      uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
      sources: {
        open_data: {
          status: odCount > 0 ? 'ok' : 'unavailable',
          stops_cached: odCount,
          age_seconds: Math.floor(openData.getCacheAge() / 1000),
        },
        legacy_api: {
          status: ok ? 'ok' : 'unavailable',
          latency_ms: ('latency_ms' in legacy ? (legacy as any).latency_ms : null),
        },
      },
      cache: {
        stops: { loaded: odCount > 0, count: odCount, source: 'open_data' },
        lines: { loaded: lines.length > 0, count: lines.length },
      },
      version: VERSION,
    });
  } catch (err: any) {
    console.error('[health] Error:', err?.message || err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal_error', message: err?.message || 'Unknown error', source: 'internal', timestamp: new Date().toISOString() });
    }
  }
});

export default router;
