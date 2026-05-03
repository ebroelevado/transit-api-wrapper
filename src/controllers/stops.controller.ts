import logger from '../utils/logger';
import { Request, Response } from 'express';
import { NEARBY_RADIUS } from '../config';
import * as stopsService from '../services/stops.service';

export async function searchStopsRedirect(req: Request, res: Response) {
  return res.redirect(307, `/api/v1/stops?q=${encodeURIComponent((req.query.q as string) || '')}`);
}

export async function getNearbyStops(req: Request, res: Response) {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: 'invalid_params', message: 'lat and lng query parameters are required and must be numbers' });
    }
    const radiusRaw = parseFloat(req.query.radius as string);
    const radius = Number.isNaN(radiusRaw) ? NEARBY_RADIUS : radiusRaw;
    
    const limitRaw = parseInt(req.query.limit as string);
    const limit = Number.isNaN(limitRaw) ? 10 : limitRaw;

    const results = await stopsService.findNearbyStops(lat, lng, radius, limit);

    res.json({ results, total: results.length, center: { lat, lng }, radius, source: 'open_data' });
  } catch (err: any) {
    logger.error('[stops/nearby] Error:', err?.message || err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal_error', message: err?.message || 'Unknown error', source: 'internal', timestamp: new Date().toISOString() });
    }
  }
}

export async function listOrSearchStops(req: Request, res: Response) {
  try {
    const q = req.query.q as string | undefined;
    const limit = Number.isNaN(parseInt(req.query.limit as string)) ? 50 : parseInt(req.query.limit as string);
    const offset = Number.isNaN(parseInt(req.query.offset as string)) ? 0 : parseInt(req.query.offset as string);

    const { paged, total } = await stopsService.searchStops(q, offset, limit);

    res.json({ results: paged, total, query: q || null, source: 'open_data' });
  } catch (err: any) {
    logger.error('[stops] Error:', err?.message || err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal_error', message: err?.message || 'Unknown error', source: 'internal', timestamp: new Date().toISOString() });
    }
  }
}

export async function getStopDetail(req: Request, res: Response) {
  try {
    const stopId = parseInt(req.params.stop as string);
    if (isNaN(stopId)) {
      return res.status(400).json({ error: 'invalid_params', message: 'stopId must be a number' });
    }

    const details = await stopsService.getStopDetails(stopId);
    if (!details) {
      return res.status(404).json({ error: 'stop_not_found', message: `La parada ${stopId} no existe` });
    }

    res.json(details);
  } catch (err: any) {
    logger.error('[stops/:stop] Error:', err?.message || err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal_error', message: err?.message || 'Unknown error', source: 'internal', timestamp: new Date().toISOString() });
    }
  }
}
