import { Router, Request, Response } from 'express';
import path from 'path';
import { DATA_DIR } from '../config';

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────

interface RawCard {
  id: string;
  tipo: string;
  descripcion: string;
  modelo_gestion: string;
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
  type: string;
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
  // Simplified fallback chain
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

router.get('/', (_req: Request, res: Response) => {
  const cards = loadCards();
  const fares = cards.map(cardToFare);
  res.json({ fares, total: fares.length });
});

// ─── GET /api/v1/fares/compare ────────────────────────────────────────

router.get('/compare', (_req: Request, res: Response) => {
  const cards = loadCards();
  const fares = cards.map(cardToFare);
  res.json(fares);
});

// ─── GET /api/v1/fares/calculator ─────────────────────────────────────

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

  interface Option {
    id: string;
    name: string;
    monthly_cost: number;
    eligible: boolean;
    reason?: string;
  }

  const options: Option[] = [];

  // 1. Tarjeta estándar recargable (payAsYouGo)
  const estandarCost = trips * 0.4;
  options.push({
    id: 'estandar',
    name: 'Tarjeta estándar recargable',
    monthly_cost: Math.round(estandarCost * 100) / 100,
    eligible: true,
  });

  // 2. Carné Trimestral Joven (age <= 25)
  const jovenMonthly = 25.5 / 3; // 8.50
  options.push({
    id: 'jovenTrimestral',
    name: 'Carné Trimestral Joven',
    monthly_cost: Math.round(jovenMonthly * 100) / 100,
    eligible: age <= 25,
    ...(age > 25 ? { reason: 'Edad máxima: 25 años' } : {}),
  });

  // 3. Tarjeta para personas con discapacidad
  const discapacidadMonthly = 10.20;
  options.push({
    id: 'discapacidad',
    name: 'Tarjeta para personas con discapacidad',
    monthly_cost: Math.round(discapacidadMonthly * 100) / 100,
    eligible: true,
    reason: 'Requiere grado de discapacidad reconocido del 33% al 64%',
  });

  // 4. Tarjeta de Familia Numerosa (free)
  options.push({
    id: 'familiaNumerosa',
    name: 'Tarjeta de Familia Numerosa',
    monthly_cost: 0,
    eligible: true,
    reason: 'Requiere título oficial de familia numerosa',
  });

  // 5. Tarjeta Mayor (age >= 65, free)
  options.push({
    id: 'mayor',
    name: 'Tarjeta Mayor',
    monthly_cost: 0,
    eligible: age >= 65,
    ...(age < 65 ? { reason: 'Para pensionistas mayores de 65 años' } : {}),
  });

  // 6. Tarjeta PequeTUS (age 4-6, free)
  const pequeEligible = age >= 4 && age <= 6;
  options.push({
    id: 'pequeTUS',
    name: 'Tarjeta PequeTUS',
    monthly_cost: 0,
    eligible: pequeEligible,
    ...(pequeEligible ? {} : { reason: 'Para niños de 4 a 6 años' }),
  });

  // 7. Tarjeta Juvenil (age 8-14, free)
  const juvenilEligible = age >= 8 && age <= 14;
  options.push({
    id: 'juvenil',
    name: 'Tarjeta Juvenil',
    monthly_cost: 0,
    eligible: juvenilEligible,
    ...(juvenilEligible ? {} : { reason: 'Para jóvenes de 8 a 14 años' }),
  });

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
