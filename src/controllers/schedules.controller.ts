import { Request, Response } from 'express';
import { getDayType, dayTypeName } from '../utils/lineMapping';
import * as schedulesService from '../services/schedules.service';
import { ApiError } from '../utils/ApiError';

const dayMap: Record<string, string> = { weekday: 'L', saturday: 'S', holiday: 'F' };
const directionMap: Record<string, string> = { forward: '1', backward: '2' };

export async function getLineSchedules(req: Request, res: Response) {
  const line = req.params.line as string;
  const dayParam = req.query.day as string | undefined;
  const directionParam = req.query.direction as string;
  const limit = req.query.limit as number | undefined;

  const day = dayParam ? dayMap[dayParam] : getDayType();
  const direction = directionMap[directionParam] || '1';

  if (limit === 1) {
    const result = schedulesService.fetchNextService(line, direction, day);
    if (result.error === 'not_available') {
      throw new ApiError(404, 'SCHEDULE_NOT_FOUND', `La línea '${line}' no tiene horarios disponibles`, { source: 'static' });
    }
    if (result.error === 'not_found') {
      throw new ApiError(404, 'SCHEDULE_NOT_FOUND', `No hay horarios para la línea '${line}' en día ${dayTypeName(day)} dirección ${direction}`, { source: 'static' });
    }
    return res.json(result);
  }

  const result = schedulesService.fetchLineSchedules(line, direction, day);
  if (result.error === 'not_available') {
    throw new ApiError(404, 'SCHEDULE_NOT_FOUND', `La línea '${line}' no tiene horarios disponibles`, { source: 'static' });
  }
  if (result.error === 'not_found') {
    throw new ApiError(404, 'SCHEDULE_NOT_FOUND', `No hay horarios para la línea '${line}' en día ${dayTypeName(day)} dirección ${direction}`, { source: 'static' });
  }

  res.json(result);
}

export async function getStopSchedules(req: Request, res: Response) {
  const stopId = req.params.stop as unknown as number;
  const dayParam = req.query.day as string | undefined;

  const day = dayParam ? dayMap[dayParam] : getDayType();
  const result = schedulesService.fetchStopSchedules(stopId, day);
  res.json(result);
}
