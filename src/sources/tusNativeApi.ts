import fetch from 'node-fetch';
import { TUS_NATIVE_BASE, TUS_NATIVE_AUTH } from '../config';
import { throttledFetch } from '../utils/upstreamThrottle';
import logger from '../utils/logger';

const TIMEOUT_MS = 5000;

// ─── Types ──────────────────────────────────────────────────────────

export interface TusEstimation {
  vehicle: number;
  destination: string;
  remainingDist: number;
  remainingTime: number;
  lon: number;
  lat: number;
  trip: number;
  dist: number;
  rt: boolean;
}

export interface TusLineEstimation {
  line: number;
  estimations: TusEstimation[];
}

export type TusNativeResponse = TusLineEstimation[];

export interface TusNativeUnavailable {
  error: 'tus_native_unavailable';
}

// ─── Shared error result ────────────────────────────────────────────

function unavailable(): TusNativeUnavailable {
  return { error: 'tus_native_unavailable' as const };
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Fetch real-time arrival estimations from the TUS Native API (RedParsec).
 * 
 * @param stopId Numeric stop ID
 * @returns Raw TUS Native response on success, or { error: 'tus_native_unavailable' }
 */
export async function getEstimations(
  stopId: number,
): Promise<TusNativeResponse | TusNativeUnavailable> {
  return throttledFetch(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const url = `${TUS_NATIVE_BASE}/stops/${stopId}/estimations`;
      const res = await fetch(url, {
        method: 'GET',
        headers: { 
          'Authorization': TUS_NATIVE_AUTH,
          'Accept': 'application/json'
        },
        signal: controller.signal as any,
      });

      if (!res.ok) {
        logger.warn({ status: res.status, stopId }, '[tusNative] HTTP error from Native API');
        return unavailable();
      }

      // Some upstream endpoints return empty body for 200 — handle gracefully
      const text = await res.text();
      if (!text || text.trim().length === 0) {
        logger.warn({ stopId }, '[tusNative] Empty response body — treating as no active buses');
        return [] as TusNativeResponse;
      }
      const json = JSON.parse(text) as TusNativeResponse;
      return json;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        logger.warn({ stopId }, '[tusNative] Timeout fetching estimations');
      } else {
        logger.warn({ err, stopId }, '[tusNative] Fetch error (upstream may be unavailable)');
      }
      return unavailable();
    } finally {
      clearTimeout(timer);
    }
  });
}

/**
 * Health check against the TUS Native API.
 * 
 * Sends GET /stops/101/estimations (reference stop).
 */
export async function getHealth(): Promise<
  { ok: true; latency_ms: number } | TusNativeUnavailable
> {
  const start = Date.now();
  // Using a known central stop for health check
  const res = await getEstimations(101);

  if (!res || 'error' in res) {
    return unavailable();
  }

  return { ok: true, latency_ms: Date.now() - start };
}

/**
 * Fetch all active vehicles from the TUS Native API.
 */
export async function getVehicles(): Promise<
  Array<{ vehicle: number; line: string; destination: string; lat: number; lng: number; delay: number }>
> {
  const url = `${TUS_NATIVE_BASE}/vehicles`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 
        'Authorization': TUS_NATIVE_AUTH,
        'Accept': 'application/json'
      },
    });

    if (!res.ok) return [];

    const json = await res.json() as any[];
    return json.map((v: any) => ({
      vehicle: v.vehicle,
      line: v.line,
      destination: v.destination,
      lat: v.lat,
      lng: v.lon,
      delay: v.delay || 0,
    }));
  } catch (err) {
    logger.error({ err }, '[tusNative] Failed to fetch vehicles');
    return [];
  }
}
