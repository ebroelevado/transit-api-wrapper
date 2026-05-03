import { Router } from 'express';
import * as tripController from '../controllers/trip.controller';
import { strictLimiter } from '../middleware/rateLimiter';

const router = Router();

router.get('/trip', strictLimiter, tripController.planTrip);
router.get('/stops/:stop/connections', strictLimiter, tripController.getConnections);

export default router;

