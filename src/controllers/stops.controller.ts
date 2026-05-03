import logger from '../utils/logger';
import { Request, Response } from 'express';
import { NEARBY_RADIUS } from '../config';
import * as stopsService from '../services/stops.service';
import { ApiError } from '../utils/ApiError';

export async function searchStopsRedirect(req: Request, res: Response) {
  return res.redirect(307, `/api/v1/stops?q=${encodeURIComponent((req.query.q as string) || '')}`);
}

export async function getNearbyStops(req: Request, res: Response) {
  const lat = req.query.lat as unknown as number;
  const lng = req.query.lng as unknown as number;
  const radius = (req.query.radius as unknown as number | undefined) ?? NEARBY_RADIUS;
  const limit = req.query.limit as unknown as number;

  const results = await stopsService.findNearbyStops(lat, lng, radius, limit);
  res.json({ results, total: results.length, center: { lat, lng }, radius, source: 'open_data' });
}

export async function listOrSearchStops(req: Request, res: Response) {
  const q = req.query.q as string | undefined;
  const limit = req.query.limit as unknown as number;
  const offset = req.query.offset as unknown as number;

  const { paged, total } = await stopsService.searchStops(q, offset, limit);
  res.json({ results: paged, total, query: q || null, source: 'open_data' });
}

export async function getStopDetail(req: Request, res: Response) {
  const stopId = req.params.stop as unknown as number;

  const details = await stopsService.getStopDetails(stopId);
  if (!details) {
    throw new ApiError(404, 'STOP_NOT_FOUND', `La parada ${stopId} no existe`, { source: 'open_data' });
  }

  res.json(details);
}
