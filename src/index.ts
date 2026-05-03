import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { PORT, VERSION } from './config';
import * as lineIndex from './sources/lineIndex';
import { globalLimiter, strictLimiter } from './middleware/rateLimiter';
import { requestLogger } from './middleware/requestLogger';
import logger from './utils/logger';
import { errorHandler } from './middleware/errorHandler';

// ── Global crash handlers ───────────────────────────────────────────
process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason, promise: String(promise) }, '[crash] Unhandled Rejection');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, '[crash] Uncaught Exception');
});

// ── Route imports ───────────────────────────────────────────────────
import swaggerUi from 'swagger-ui-express';
const swaggerUiAny: any = swaggerUi;
import { swaggerSpec } from './swagger';
import healthRouter from './routes/health';
import discoverRouter from './routes/discover';
import linesRouter from './routes/lines';
import stopsRouter from './routes/stops';
import arrivalsRouter from './routes/arrivals';
import mapRouter from './routes/map';
import tripRouter from './routes/trip';
import batchRouter from './routes/batch';
import compareRouter from './routes/compare';
import timeRouter from './routes/time';
import faresRouter from './routes/fares';
import alertsRouter from './routes/alerts';
import dxRouter from './routes/dx';

const app = express();

// ── Middleware ──────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(globalLimiter);
app.use(requestLogger);

// ── Mount routers ───────────────────────────────────────────────────
// Swagger docs
app.use('/api/v1/docs', swaggerUiAny.serve, swaggerUiAny.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { background-color: #1a1a2e; }',
  customSiteTitle: 'TUS Santander API Docs',
}));
app.use('/api/v1/docs.json', (_req, res) => res.json(swaggerSpec));

// Order matters: more specific paths should come before generic ones
// Health is first so it always works
app.use('/api/v1', healthRouter);         // GET /api/v1/health
app.use('/api/v1', discoverRouter);       // GET|HEAD /api/v1/discover
app.use('/api/v1', linesRouter);          // GET /api/v1/lines, /lines/:line, /lines/:line/route, /lines/:A/intersect/:B
app.use('/api/v1', arrivalsRouter);       // GET /api/v1/stops/:stop/arrivals, /next, /next/:line, /arrivals/:line, /lines/:line/next-at/:stop
app.use('/api/v1', stopsRouter);          // GET /api/v1/stops, /stops/:stop
app.use('/api/v1/map', mapRouter);        // GET /api/v1/map/stops, /map/lines, /map/lines/:line
app.use('/api/v1', tripRouter);           // GET /api/v1/trip?from=&to=, /stops/:stop/connections
app.use('/api/v1/batch', batchRouter);    // POST /api/v1/batch/arrivals, /batch/stops, /batch/lines
app.use('/api/v1/compare', compareRouter); // POST /api/v1/compare/lines
app.use('/api/v1', timeRouter);           // GET /api/v1/now, /stops/:stop/etd, /stops/:stop/arrivals/absolute
app.use('/api/v1/fares', faresRouter);    // GET /api/v1/fares, /fares/:id, /fares/compare, /fares/calculator
app.use('/api/v1', alertsRouter);         // GET /api/v1/alerts, /lines/:line/status
app.use('/', dxRouter);                   // OPTIONS /api/v1, GET /dx/info

// ── 404 catch-all ───────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: 'not_found',
    message: `Endpoint not found: ${_req.method} ${_req.path}`,
    source: 'internal',
    timestamp: new Date().toISOString(),
  });
});

// ── Global error handler ────────────────────────────────────────────
app.use(errorHandler);

// ── Startup ─────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    logger.info({ port: PORT }, `[server] Listening on http://localhost:${PORT}`);
  });
}

// Pre-warm caches in background (non-blocking)
lineIndex.buildLineIndex()
  .then(() => logger.info({ lines: lineIndex.getLines().length }, '[server] Line index ready'))
  .catch((err: Error) => logger.warn({ err }, '[server] Could not build line index'));

import('./sources/openData').then((od) => {
  od.getStops().then((stops) => {
    logger.info({ stops: stops.length }, '[server] Open Data cache pre-warmed');
  });
}).catch(() => {
  logger.warn('[server] Could not pre-warm Open Data cache');
});

export default app;
