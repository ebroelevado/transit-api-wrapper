import { Router } from 'express';
import * as arrivalsController from '../controllers/arrivals.controller';
import { strictLimiter } from '../middleware/rateLimiter';

const router = Router();

router.get('/arrivals/:line', strictLimiter, arrivalsController.getArrivalsForLine);
router.get('/stops/:stop/arrivals', strictLimiter, arrivalsController.getArrivalsForStop);
router.get('/stops/:stop/arrivals/:line', strictLimiter, arrivalsController.getArrivalsForStopAndLine);
router.get('/stops/:stop/next', strictLimiter, arrivalsController.getNextArrivalForStop);
router.get('/stops/:stop/next/:line', strictLimiter, arrivalsController.getNextArrivalForStopAndLine);
router.get('/lines/:line/next-at/:stop', strictLimiter, arrivalsController.getNextAtForLineAndStop);

export default router;

