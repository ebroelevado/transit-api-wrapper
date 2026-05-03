import { Request, Response } from 'express';
import * as arrivalsService from '../services/arrivals.service';
import { ApiError } from '../utils/ApiError';

export async function getArrivals(req: Request, res: Response) {
  // Parámetros validados por Zod y parseados correctamente
  const stopId = req.params.stop as unknown as number;
  const lineFilter = req.query.line as string | undefined;
  const limit = req.query.limit as number | undefined;
  const refresh = req.query.refresh === 'true';

  try {
    const response = await arrivalsService.fetchSmartArrivals(stopId, lineFilter, refresh);
    
    if (!response) {
      throw new ApiError(404, 'STOP_NOT_FOUND', `La parada ${stopId} no existe`, { source: 'open_data' });
    }

    if (limit && response.arrivals) {
      response.arrivals = response.arrivals.slice(0, limit);
    }

    res.json(response);
  } catch (err: any) {
    if (err.message === 'legacy_unavailable') {
      throw new ApiError(503, 'LEGACY_UNAVAILABLE', 'Legacy API no responde', { source: 'legacy_api' });
    }
    throw err; // Pasa al manejador de errores global
  }
}
