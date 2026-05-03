import { Router, Request, Response } from 'express';
import path from 'path';
import { DATA_DIR } from '../config';

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────

interface RawCard {
  id: string;
  tipo: string; // name
  descripcion: string;
  modelo_gestion: string; // type
  coste_viaje_2025?: number;
  precio_trimestre?: number;
  precio_mensual?: number;
  precio?: number;
  color: string;
  features: { titulo: string; detalle: string; icono?: string }[];
}

interface Fare {
  id: string;
  name: string;
  type: string; // modelo_gestion
  description: string;
  price_per_trip: number | null;
  color: string;
  features: { title: string; detail: string }[];
}

let cardsCache: RawCard[] | null = null;

function loadCards(): RawCard[] {
  if (cardsCache) return cardsCache;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const raw = require(path.join(DATA_DIR, 'cards.json')) as { tarjetas_tus: RawCard[] };
  cardsCache = raw.tarjetas_tus || [];
  return cardsCache;
}

function cardToFare(card: RawCard): Fare {
  const price_per_trip =
    card.coste_viaje_2025 ??
    (card.precio_trimestre != null ? card.precio_trimestre / 3 : null) ??
    card.precio_mensual ??
    card.precio ??
    null;

  return {
    id: card.id,
    name: card.tipo,
    type: card.modelo_gestion,
    description: card.descripcion,
    price_per_trip,
    color: card.color,
    features: (card.features || []).map((f) => ({
      title: f.titulo,
      detail: f.detalle,
    })),
  };
}

// ─── GET /api/v1/fares ────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/fares:
 *   get:
 *     tags: [Fares]
 *     summary: Listar las 7 tarjetas y abonos TUS
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */
router.get('/', (_req: Request, res: Response) => {
  const cards = loadCards();
  const fares = cards.map(cardToFare);
  res.json({ fares, total: fares.length });
});

// ─── GET /api/v1/fares/compare ────────────────────────────────────────
// Must be defined BEFORE /:id to avoid "compare" being treated as an id

/**
 * @swagger
 * /api/v1/fares/compare:
 *   get:
 *     tags: [Fares]
 *     summary: Comparativa de todas las tarifas
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */
router.get('/compare', (_req: Request, res: Response) => {
  const cards = loadCards();
  const fares = cards.map(cardToFare);
  res.json(fares);
});

// ─── GET /api/v1/fares/calculator ─────────────────────────────────────
// Also before /:id

/**
 * @swagger
 * /api/v1/fares/calculator:
 *   get:
 *     tags: [Fares]
 *     summary: "Calculadora: opción más barata según uso mensual y edad"
 *     parameters:
 *       - in: query
 *         name: trips
 *         schema:
 *           type: integer
 *           default: 40
 *       - in: query
 *         name: age
 *         schema:
 *           type: integer
 *           default: 16
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */
router.get('/calculator', (req: Request, res: Response) => {
  const trips = parseInt(req.query.trips as string, 10) || 0;
  const age = parseInt(req.query.age as string, 10) || 0;

  if (trips < 0) {
    return res.status(400).json({
      error: 'invalid_params',
      message: 'trips must be >= 0',
      source: 'static',
      timestamp: new Date().toISOString(),
    });
  }

  const options: {
    id: string;
    name: string;
    monthly_cost: number;
    eligible: boolean;
    reason?: string;
  }[] = [];

  // Pay-as-you-go (estándar)
  const estandarCost = trips * 0.4;
  options.push({
    id: 'estandar',
    name: 'Tarjeta estándar recargable',
    monthly_cost: Math.round(estandarCost * 100) / 100,
    eligible: true,
  });

  // Joven Trimestral (only if age <= 25)
  const jovenMonthly = 25.5 / 3; // 8.50
  if (age <= 25) {
    options.push({
      id: 'jovenTrimestral',
      name: 'Carné Trimestral Joven',
      monthly_cost: Math.round(jovenMonthly * 100) / 100,
      eligible: true,
    });
  } else {
    options.push({
      id: 'jovenTrimestral',
      name: 'Carné Trimestral Joven',
      monthly_cost: Math.round(jovenMonthly * 100) / 100,
      eligible: false,
      reason: 'Edad máxima: 25 años',
    });
  }

  // Sort by monthly cost ascending
  options.sort((a, b) => a.monthly_cost - b.monthly_cost);

  const eligible = options.filter((o) => o.eligible);
  const cheapest = eligible.length > 0 ? eligible[0] : options[0];

  res.json({
    trips_per_month: trips,
    age,
    options,
    cheapest: { id: cheapest.id, monthly_cost: cheapest.monthly_cost },
  });
});

// ─── GET /api/v1/fares/:id ────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/fares/{id}:
 *   get:
 *     tags: [Fares]
 *     summary: Detalle de una tarjeta/abono
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       404:
 *         description: fare_not_found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */
router.get('/:id', (req: Request, res: Response) => {
  const cards = loadCards();
  const card = cards.find((c) => c.id === req.params.id);

  if (!card) {
    return res.status(404).json({
      error: 'fare_not_found',
      message: `La tarjeta '${req.params.id}' no existe`,
      source: 'static',
      timestamp: new Date().toISOString(),
    });
  }

  res.json(cardToFare(card));
});

export default router;
