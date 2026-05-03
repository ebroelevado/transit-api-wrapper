import logger from '../utils/logger';
import { Request, Response } from 'express';
import * as linesService from '../services/lines.service';

export async function getLines(_req: Request, res: Response) {
  try {
    const lines = await linesService.getLines();
    res.json({
      lines,
      total: lines.length,
      updated: new Date().toISOString(),
    });
  } catch (err: any) {
    logger.error('[lines] Error:', err?.message || err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal_error', message: err?.message || 'Unknown error', source: 'internal', timestamp: new Date().toISOString() });
    }
  }
}

export async function getLineDetail(req: Request, res: Response) {
  try {
    const detail = await linesService.getLineDetail(req.params.line as string);
    if (!detail) {
      return res.status(404).json({ error: 'line_not_found', message: `La línea '${req.params.line}' no existe` });
    }
    res.json(detail);
  } catch (err: any) {
    logger.error('[lines] Error:', err?.message || err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal_error', message: err?.message || 'Unknown error', source: 'internal', timestamp: new Date().toISOString() });
    }
  }
}

export async function getLineStops(req: Request, res: Response) {
  try {
    const stops = await linesService.getLineStops(req.params.line as string);
    if (!stops) {
      return res.status(404).json({ error: 'line_not_found', message: `La línea '${req.params.line}' no existe` });
    }
    res.json(stops);
  } catch (err: any) {
    logger.error('[lines/stops] Error:', err?.message || err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal_error', message: err?.message || 'Unknown error', source: 'internal', timestamp: new Date().toISOString() });
    }
  }
}

export async function getLineRoute(req: Request, res: Response) {
  try {
    const route = await linesService.getLineRoute(req.params.line as string, (req.query.direction as string) || 'all');
    if (!route) {
      return res.status(404).json({ error: 'line_not_found', message: `La línea '${req.params.line}' no existe` });
    }
    res.json(route);
  } catch (err: any) {
    logger.error('[lines] Error:', err?.message || err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal_error', message: err?.message || 'Unknown error', source: 'internal', timestamp: new Date().toISOString() });
    }
  }
}

export async function getLinesIntersect(req: Request, res: Response) {
  try {
    const a = req.params.lineA as string;
    const b = req.params.lineB as string;

    const intersect = await linesService.getLinesIntersect(a, b);
    
    if ('error' in intersect) {
      if (intersect.missingA) return res.status(404).json({ error: 'line_not_found', message: `La línea '${a}' no existe` });
      if (intersect.missingB) return res.status(404).json({ error: 'line_not_found', message: `La línea '${b}' no existe` });
    }

    res.json(intersect);
  } catch (err: any) {
    logger.error('[lines] Error:', err?.message || err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal_error', message: err?.message || 'Unknown error', source: 'internal', timestamp: new Date().toISOString() });
    }
  }
}
