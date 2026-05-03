import { Router } from 'express';
import * as arrivalsController from '../controllers/arrivals.controller';
import { strictLimiter } from '../middleware/rateLimiter';
import { validate } from '../middleware/validate';
import { arrivalsQuerySchema } from '../schemas/api.schemas';

const router = Router();

router.get(
  '/stops/:stop/arrivals',
  strictLimiter,
  validate(arrivalsQuerySchema),
  arrivalsController.getArrivals
);

export default router;

