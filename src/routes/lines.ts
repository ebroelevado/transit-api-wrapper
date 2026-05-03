import { Router } from 'express';
import * as linesController from '../controllers/lines.controller';
import * as schedulesController from '../controllers/schedules.controller';
import { validate } from '../middleware/validate';
import { schedulesQuerySchema } from '../schemas/api.schemas';

const router = Router();

router.get('/lines', linesController.getLines);
router.get('/lines/:line', linesController.getLineDetail);
router.get('/lines/:line/stops', linesController.getLineStops);
router.get('/lines/:line/route', linesController.getLineRoute);
router.get('/lines/:lineA/intersect/:lineB', linesController.getLinesIntersect);
router.get('/lines/:line/schedules', validate(schedulesQuerySchema), schedulesController.getLineSchedules);

export default router;
