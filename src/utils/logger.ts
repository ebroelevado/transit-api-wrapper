// ─── Structured Logger (Pino) ─────────────────────────────────────────────────
// Singleton logger used across the entire application.
//
// Configuration:
//   • LOG_LEVEL env var controls verbosity (default: 'info')
//   • In development (NODE_ENV=development), uses pino-pretty for human-readable output
//   • In production, outputs newline-delimited JSON
//
// Usage:
//   import logger from '../utils/logger';
//   logger.info({ stopId: 41 }, 'Cache miss, fetching from API');
//   logger.error({ err }, 'Failed to fetch stops');

import pino from 'pino';

const isDev = process.env.NODE_ENV === 'development';
const level = process.env.LOG_LEVEL ?? 'info';

const logger = pino({
  level,
  // Rename 'msg' field to 'message' for better compatibility with log aggregators
  messageKey: 'message',
  timestamp: pino.stdTimeFunctions.isoTime,
  base: {
    service: 'transit-api-wrapper',
    env: process.env.NODE_ENV ?? 'production',
  },
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname,service,env',
          },
        },
      }
    : {}),
});

export default logger;
