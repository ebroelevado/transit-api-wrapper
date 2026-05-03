import { Router } from 'express';
import * as stopsController from '../controllers/stops.controller';
import * as schedulesController from '../controllers/schedules.controller';
import { validate } from '../middleware/validate';
import { searchStopsSchema, nearbyStopsSchema, stopIdSchema, stopSchedulesSchema } from '../schemas/api.schemas';

const router = Router();

// MUST be registered before /stops/:stop to avoid captures
router.get('/stops/search', stopsController.searchStopsRedirect);
router.get('/stops/nearby', validate(nearbyStopsSchema), stopsController.getNearbyStops);

router.get('/stops', validate(searchStopsSchema), stopsController.listOrSearchStops);
router.get('/stops/:stop', validate(stopIdSchema), stopsController.getStopDetail);
router.get('/stops/:stop/schedules', validate(stopSchedulesSchema), schedulesController.getStopSchedules);

export default router;
