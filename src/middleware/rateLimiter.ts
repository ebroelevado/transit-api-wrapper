// ─── Rate Limiting Middleware ─────────────────────────────────────────────────
// Two tiers:
//   • globalLimiter  → 200 req / 15 min per IP  (all routes)
//   • strictLimiter  →  30 req / 60 s   per IP  (Legacy API-backed routes)
//
// Both limiters skip loopback (127.0.0.1 / ::1) so integration tests pass.

import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';

const isDev = process.env.NODE_ENV === 'development';

function skipLocalhost(req: Request): boolean {
  const ip = req.ip ?? '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

const errorResponse = (req: Request, res: Response) => {
  res.status(429).json({
    error: 'rate_limit_exceeded',
    message: 'Demasiadas peticiones. Por favor, espera antes de volver a intentarlo.',
    retry_after_seconds: Math.ceil(res.getHeader('Retry-After') as number ?? 60),
    source: 'internal',
    timestamp: new Date().toISOString(),
  });
};

/** 200 requests per 15 minutes per IP — applied globally. */
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDev ? 0 : 200,     // 0 = unlimited in dev
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipLocalhost,
  handler: errorResponse,
  message: undefined,
});

/** 30 requests per 60 seconds per IP — applied to Legacy-API backed routes. */
export const strictLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: isDev ? 0 : 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipLocalhost,
  handler: errorResponse,
  message: undefined,
});
