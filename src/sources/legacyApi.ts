import fetch from 'node-fetch';
import { LEGACY_API_BASE } from '../config';

const TIMEOUT_MS = 5000;

// ─── Types ──────────────────────────────────────────────────────────

/** A single arrival entry from the Legacy API: [label, destination, nextMinutes, followingMinutes] */
export type LegacyArrivalEntry = [string, string, number, number];

/** Full arrivals response: [[arrivals...], allLineLabels] */
export type LegacyArrivalsResponse = [LegacyArrivalEntry[], string[]];

/** A route stop entry: [stopId, stopName, [lines...]] */
export type LegacyRouteStopEntry = [number, string, string[]];

/** Legacy API error response */
export interface LegacyUnavailable {
  error: 'legacy_unavailable';
}

// ─── Shared error result ────────────────────────────────────────────

function unavailable(): LegacyUnavailable {
  return { error: 'legacy_unavailable' as const };
}

// ─── Internal POST helper ───────────────────────────────────────────

async function post<T>(path: string, body: Record<string, unknown>): Promise<T | LegacyUnavailable> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${LEGACY_API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal as any, // node-fetch v2 typing quirk
    });

    if (!res.ok) {
      return unavailable();
    }

    const json: T = await res.json();
    return json;
  } catch (_err) {
    return unavailable();
  } finally {
    clearTimeout(timer);
  }
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Fetch real-time arrival estimations for a stop, optionally filtered by line.
 *
 * Legacy response shape:
 *   [ [[label, destination, nextMinutes, followingMinutes]], allLineLabels ]
 * When `lineLabel` is provided, the second element contains upcoming stops.
 *
 * Returns raw Legacy response on success, or `{ error: 'legacy_unavailable' }`.
 */
export async function getArrivals(
  stopId: number,
  lineLabel?: string,
): Promise<LegacyArrivalsResponse | LegacyUnavailable> {
  const body: Record<string, unknown> = { stopId };
  if (lineLabel) {
    body.lineLabel = lineLabel;
  }
  return post<LegacyArrivalsResponse>('/api/v1/estimations/get-compact', body);
}

/**
 * Fetch the ordered route stops for a given line from a specific stop.
 *
 * Legacy response shape:
 *   [[stopId, stopName, [lines]], ...]
 * An empty array `[]` means the stop is not found on that line — NOT an error.
 *
 * Returns raw Legacy response on success, or `{ error: 'legacy_unavailable' }`.
 */
export async function getRoute(
  stopId: number,
  lineLabel: string,
): Promise<LegacyRouteStopEntry[] | LegacyUnavailable> {
  return post<LegacyRouteStopEntry[]>('/api/v1/routes/get-compact', { stopId, lineLabel });
}

/**
 * Health check against the Legacy API.
 *
 * Sends GET /health. Returns `{ ok: true, latency_ms: number }` on success
 * or `{ error: 'legacy_unavailable' }` on failure.
 */
export async function getHealth(): Promise<
  { ok: true; latency_ms: number } | LegacyUnavailable
> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${LEGACY_API_BASE}/health`, {
      method: 'GET',
      signal: controller.signal as any,
    });

    if (!res.ok) {
      return unavailable();
    }

    return { ok: true, latency_ms: Date.now() - start };
  } catch (_err) {
    return unavailable();
  } finally {
    clearTimeout(timer);
  }
}
