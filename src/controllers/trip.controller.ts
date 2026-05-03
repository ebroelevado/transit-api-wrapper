import { Request, Response } from 'express';
import { buildLineIndex, getStopName } from '../sources/lineIndex';
import { resolveStop } from '../utils/helpers';
import * as tripService from '../services/trip.service';

export async function planTrip(req: Request, res: Response) {
  try {
    const fromId = parseInt(req.query.from as string, 10);
    const toId = parseInt(req.query.to as string, 10);

    if (isNaN(fromId) || isNaN(toId)) {
      return res.status(400).json({ error: 'invalid_params', message: 'Both "from" and "to" query parameters (stop IDs) are required', source: 'cache', timestamp: new Date().toISOString() });
    }

    if (fromId === toId) {
      return res.status(200).json({ from: { stopId: fromId, name: getStopName(fromId) || 'Unknown' }, to: { stopId: toId, name: getStopName(toId) || 'Unknown' }, options: [], summary: { total_options: 0, direct_count: 0, transfer_count: 0, best_duration_min: null, message: 'Origin and destination are the same' } });
    }

    await buildLineIndex();
    const fromStop = await resolveStop(fromId);
    const toStop = await resolveStop(toId);

    if (!fromStop) return res.status(404).json({ error: 'stop_not_found', message: `Origin stop ${fromId} not found`, source: 'cache', timestamp: new Date().toISOString() });
    if (!toStop) return res.status(404).json({ error: 'stop_not_found', message: `Destination stop ${toId} not found`, source: 'cache', timestamp: new Date().toISOString() });

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
  } catch (err) {
    res.status(500).json({ error: 'trip_error', message: 'Failed to plan trip', source: 'cache', timestamp: new Date().toISOString() });
  }
}

export async function getConnections(req: Request, res: Response) {
  try {
    const stopId = parseInt(req.params.stop as string, 10);
    if (isNaN(stopId)) {
      return res.status(400).json({ error: 'invalid_stop', message: 'Stop ID must be a number', source: 'cache', timestamp: new Date().toISOString() });
    }

    await buildLineIndex();
    const originStop = await resolveStop(stopId);
    if (!originStop) {
      return res.status(404).json({ error: 'stop_not_found', message: `Stop ${stopId} not found`, source: 'cache', timestamp: new Date().toISOString() });
    }

    const reachable_stops = await tripService.buildConnections(stopId);
    res.json({ stop: { stopId, name: originStop.name }, reachable_stops });
  } catch (err) {
    res.status(500).json({ error: 'connections_error', message: 'Failed to get connections', source: 'cache', timestamp: new Date().toISOString() });
  }
}
