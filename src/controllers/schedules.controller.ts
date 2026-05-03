import { Request, Response } from 'express';
import { getDayType, dayTypeName } from '../utils/lineMapping';
import * as schedulesService from '../services/schedules.service';

export async function getLineSchedules(req: Request, res: Response) {
  const line = req.params.line as string;
  const day = (req.query.day as string) || getDayType();
  const direction = (req.query.direction as string) || '1';

  if (!['L', 'S', 'F'].includes(day)) {
    return res.status(400).json({ error: 'invalid_params', message: "day must be one of: L, S, F", source: 'static' });
  }
  if (!['1', '2'].includes(direction)) {
    return res.status(400).json({ error: 'invalid_params', message: 'direction must be 1 or 2', source: 'static' });
  }

  const result = schedulesService.fetchLineSchedules(line, direction, day);
  if (result.error === 'not_available') {
    return res.status(404).json({ error: 'schedule_not_found', message: `La línea '${line}' no tiene horarios disponibles`, source: 'static' });
  }
  if (result.error === 'not_found') {
    return res.status(404).json({ error: 'schedule_not_found', message: `No hay horarios para la línea '${line}' (${result.key}) en día ${dayTypeName(day)} dirección ${direction}`, source: 'static' });
  }

  res.json(result);
}

export async function getNextLineSchedule(req: Request, res: Response) {
  const line = req.params.line as string;
  const day = (req.query.day as string) || getDayType();
  const direction = (req.query.direction as string) || '1';

  if (!['L', 'S', 'F'].includes(day)) {
    return res.status(400).json({ error: 'invalid_params', message: "day must be one of: L, S, F", source: 'static' });
  }
  if (!['1', '2'].includes(direction)) {
    return res.status(400).json({ error: 'invalid_params', message: 'direction must be 1 or 2', source: 'static' });
  }

  const result = schedulesService.fetchNextService(line, direction, day);
  if (result.error === 'not_available') {
    return res.status(404).json({ error: 'schedule_not_found', message: `La línea '${line}' no tiene horarios disponibles`, source: 'static' });
  }
  if (result.error === 'not_found') {
    return res.status(404).json({ error: 'schedule_not_found', message: `No hay horarios para la línea '${line}' (${result.key}) en día ${dayTypeName(day)} dirección ${direction}`, source: 'static' });
  }

  res.json(result);
}

export async function getStopSchedules(req: Request, res: Response) {
  const stopId = parseInt(req.params.stop as string, 10);
  if (isNaN(stopId)) {
    return res.status(400).json({ error: 'invalid_params', message: 'stop must be a number', source: 'static' });
  }

  const day = getDayType();
  const result = schedulesService.fetchStopSchedules(stopId, day);
  res.json(result);
}
