import { Request, Response } from 'express';
import * as arrivalsService from '../services/arrivals.service';
import { resolveStop, getColor } from '../utils/helpers';

export async function getArrivalsForLine(req: Request, res: Response) {
  try {
    const lineId = req.params.line as string;
    const stopId = parseInt(req.query.stop as string);
    if (isNaN(stopId)) {
      return res.status(400).json({ error: 'invalid_params', message: 'Query parameter ?stop= is required and must be a number' });
    }
    const filtered = await arrivalsService.fetchArrivalsForLine(lineId, stopId);
    res.json({ stop: stopId, line: lineId, arrivals: filtered, total: filtered.length, timestamp: new Date().toISOString() });
  } catch (err: any) {
    res.status(502).json({ error: 'upstream_unavailable', message: err?.message || 'Unknown error', source: 'legacy_api', timestamp: new Date().toISOString() });
  }
}

export async function getArrivalsForStop(req: Request, res: Response) {
  try {
    const stopId = parseInt(req.params.stop as string, 10);
    if (isNaN(stopId)) return res.status(400).json({ error: 'invalid_params', message: 'stop must be a number', source: 'legacy_api' });
    const response = await arrivalsService.fetchSmartArrivals(stopId, req.query.line as string | undefined, req.query.refresh === 'true');
    if (!response) return res.status(404).json({ error: 'stop_not_found', message: `La parada ${stopId} no existe`, source: 'open_data' });
    res.json(response);
  } catch (err: any) {
    if (err.message === 'legacy_unavailable') return res.status(503).json({ error: 'legacy_unavailable', message: 'Legacy API no responde', source: 'legacy_api' });
    res.status(500).json({ error: 'internal_error', message: 'Failed to get arrivals', source: 'internal' });
  }
}

export async function getArrivalsForStopAndLine(req: Request, res: Response) {
  try {
    const stopId = parseInt(req.params.stop as string, 10);
    const lineLabel = req.params.line as string;
    if (isNaN(stopId)) return res.status(400).json({ error: 'invalid_params', message: 'stop must be a number', source: 'legacy_api' });
    const stop = await resolveStop(stopId);
    if (!stop) return res.status(404).json({ error: 'stop_not_found', message: `La parada ${stopId} no existe`, source: 'open_data' });

    const entries = await arrivalsService.fetchRawArrival(stopId, lineLabel);
    if (entries.length === 0) {
      return res.json({ line: lineLabel, destination: null, color: getColor(lineLabel), minutes: null, next: null, active: false });
    }
    const entry = entries[0];
    res.json({ line: entry[0], destination: entry[1], color: getColor(entry[0]), minutes: entry[2] >= 0 ? entry[2] : null, next: entry[3] >= 0 ? entry[3] : null, active: true });
  } catch (err: any) {
    if (err.message === 'legacy_unavailable') return res.status(503).json({ error: 'legacy_unavailable', message: 'Legacy API no responde', source: 'legacy_api' });
    res.status(500).json({ error: 'internal_error', message: err?.message || 'Internal error', source: 'internal' });
  }
}

export async function getNextArrivalForStop(req: Request, res: Response) {
  try {
    const stopId = parseInt(req.params.stop as string, 10);
    if (isNaN(stopId)) return res.status(400).json({ error: 'invalid_params', message: 'stop must be a number' });
    const stop = await resolveStop(stopId);
    if (!stop) return res.status(404).json({ error: 'stop_not_found', message: `La parada ${stopId} no existe` });

    const entries = await arrivalsService.fetchRawArrival(stopId);
    if (entries.length === 0) return res.json({ line: null, destination: null, minutes: null, color: null });
    const first = entries[0];
    res.json({ line: first[0], destination: first[1], minutes: first[2] >= 0 ? first[2] : null, color: getColor(first[0]) });
  } catch (err: any) {
    if (err.message === 'legacy_unavailable') return res.status(503).json({ error: 'legacy_unavailable', message: 'Legacy API no responde', source: 'legacy_api' });
    res.status(500).json({ error: 'internal_error', message: 'Internal error' });
  }
}

export async function getNextArrivalForStopAndLine(req: Request, res: Response) {
  try {
    const stopId = parseInt(req.params.stop as string, 10);
    const lineLabel = req.params.line as string;
    if (isNaN(stopId)) return res.status(400).json({ error: 'invalid_params', message: 'stop must be a number' });
    const stop = await resolveStop(stopId);
    if (!stop) return res.status(404).json({ error: 'stop_not_found', message: `La parada ${stopId} no existe` });

    const entries = await arrivalsService.fetchRawArrival(stopId, lineLabel);
    if (entries.length === 0) return res.json({ line: lineLabel, destination: null, minutes: null, next: null, color: getColor(lineLabel), active: false });
    const entry = entries[0];
    res.json({ line: entry[0], destination: entry[1], minutes: entry[2] >= 0 ? entry[2] : null, next: entry[3] >= 0 ? entry[3] : null, color: getColor(entry[0]), active: true });
  } catch (err: any) {
    if (err.message === 'legacy_unavailable') return res.status(503).json({ error: 'legacy_unavailable', message: 'Legacy API no responde', source: 'legacy_api' });
    res.status(500).json({ error: 'internal_error', message: 'Internal error' });
  }
}

export async function getNextAtForLineAndStop(req: Request, res: Response) {
  try {
    const lineLabel = req.params.line as string;
    const stopId = parseInt(req.params.stop as string, 10);
    if (isNaN(stopId)) return res.status(400).json({ error: 'invalid_params', message: 'stop must be a number' });
    const stop = await resolveStop(stopId);
    if (!stop) return res.status(404).json({ error: 'stop_not_found', message: `La parada ${stopId} no existe` });

    const entries = await arrivalsService.fetchRawArrival(stopId, lineLabel);
    if (entries.length === 0) return res.json({ line: lineLabel, stop: stopId, stop_name: stop.name, destination: null, minutes: null, next: null, active: false });
    const entry = entries[0];
    res.json({ line: entry[0], stop: stopId, stop_name: stop.name, destination: entry[1], minutes: entry[2] >= 0 ? entry[2] : null, next: entry[3] >= 0 ? entry[3] : null, active: true });
  } catch (err: any) {
    if (err.message === 'legacy_unavailable') return res.status(503).json({ error: 'legacy_unavailable', message: 'Legacy API no responde', source: 'legacy_api' });
    res.status(500).json({ error: 'internal_error', message: 'Internal error' });
  }
}
