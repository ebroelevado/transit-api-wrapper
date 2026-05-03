import { Router } from 'express';
import * as tripController from '../controllers/trip.controller';
import { strictLimiter } from '../middleware/rateLimiter';
import { validate } from '../middleware/validate';
import { tripQuerySchema, stopIdSchema } from '../schemas/api.schemas';

const router = Router();

router.get('/trip', strictLimiter, validate(tripQuerySchema), tripController.planTrip);
router.get('/stops/:stop/connections', strictLimiter, validate(stopIdSchema), tripController.getConnections);

export default router;

