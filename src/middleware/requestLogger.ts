// ─── HTTP Request Logger Middleware ───────────────────────────────────────────
// Logs every incoming HTTP request with:
//   • method, path, query params, response statusCode, durationMs, client IP
//
// Uses the child logger pattern so all request logs share a common requestId.
// Skips health check endpoint to avoid log spam in production.

import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

const SKIP_PATHS = new Set(['/api/v1/health', '/favicon.ico']);

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  if (SKIP_PATHS.has(req.path)) {
    return next();
  }

  const start = Date.now();
  const { method, path, query, ip } = req;

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const { statusCode } = res;
    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';

    logger[level]({
      method,
      path,
      query: Object.keys(query).length > 0 ? query : undefined,
      statusCode,
      durationMs,
      ip,
    }, `${method} ${path} ${statusCode} (${durationMs}ms)`);
  });

  next();
}
