import { Request, Response } from 'express';
import { buildLineIndex, getStopName } from '../sources/lineIndex';
import { resolveStop } from '../utils/helpers';
import * as tripService from '../services/trip.service';
import { ApiError } from '../utils/ApiError';

export async function planTrip(req: Request, res: Response) {
  const fromId = req.query.from as unknown as number;
  const toId = req.query.to as unknown as number;

  if (fromId === toId) {
    return res.status(200).json({ from: { stopId: fromId, name: getStopName(fromId) || 'Unknown' }, to: { stopId: toId, name: getStopName(toId) || 'Unknown' }, options: [], summary: { total_options: 0, direct_count: 0, transfer_count: 0, best_duration_min: null, message: 'Origin and destination are the same' } });
  }

  await buildLineIndex();
  const fromStop = await resolveStop(fromId);
  const toStop = await resolveStop(toId);

  if (!fromStop) throw new ApiError(404, 'STOP_NOT_FOUND', `Origin stop ${fromId} not found`, { source: 'cache' });
  if (!toStop) throw new ApiError(404, 'STOP_NOT_FOUND', `Destination stop ${toId} not found`, { source: 'cache' });

  const allOptions = tripService.buildTripOptions(fromId, toId);
  const topOptions = allOptions.slice(0, 10);

  if (topOptions.length === 0) {
    return res.status(200).json({ from: { stopId: fromId, name: fromStop.name }, to: { stopId: toId, name: toStop.name }, options: [], summary: { total_options: 0, direct_count: 0, transfer_count: 0, best_duration_min: null, message: 'No route found' } });
  }

  const bestDuration = topOptions[0].duration_min;
  const directCount = topOptions.filter(o => o.type === 'direct').length;
  const transferCount = topOptions.filter(o => o.type === 'transfer').length;

  res.json({
    from: { stopId: fromId, name: fromStop.name },
    to: { stopId: toId, name: toStop.name },
    options: topOptions,
    summary: { total_options: topOptions.length, direct_count: directCount, transfer_count: transferCount, best_duration_min: bestDuration, message: `${topOptions.length} route(s) found` },
  });
}

export async function getConnections(req: Request, res: Response) {
  const stopId = req.params.stop as unknown as number;

  await buildLineIndex();
  const originStop = await resolveStop(stopId);
  if (!originStop) {
    throw new ApiError(404, 'STOP_NOT_FOUND', `Stop ${stopId} not found`, { source: 'cache' });
  }

  const reachable_stops = await tripService.buildConnections(stopId);
  res.json({ stop: { stopId, name: originStop.name }, reachable_stops });
}
