// ─── Shared helpers used across route files ─────────────────────────

import { Stop } from '../types';
import colorsRaw from '../../data/colors.json';
import stopsMinRaw from '../../data/stops.min.json';
import path from 'path';
import { DATA_DIR } from '../config';
import * as openData from '../sources/openData';

// ─── Color helpers ─────────────────────────────────────────────────

/** Convert RGB array to hex color string. */
export function rgbToHex(rgb: number[]): string {
  const [r, g, b] = rgb;
  return (
    '#' +
    [r, g, b]
      .map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

/** Get hex color for a line ID, with default fallback. */
export function getColor(lineId: string): string {
  const colors = colorsRaw as Record<string, number[]>;
  const rgb = colors[lineId] || colors['default'];
  return rgbToHex(rgb);
}

// ─── Stop resolution ───────────────────────────────────────────────

/** Resolve a stop from Open Data, falling back to stops.min.json. */
export async function resolveStop(stopId: number): Promise<Stop | null> {
  const od = await openData.getStopById(stopId);
  if (od) return od;
  const key = String(stopId);
  const stopsMin = stopsMinRaw as unknown as Record<string, [number, number, number, string]>;
  if (stopsMin[key]) {
    const [, lat, lng, name] = stopsMin[key];
    return { stopId, name, lat, lng, address: null, sentido: null, lines: [], source: 'stops_min' };
  }
  return null;
}

// ─── Time helpers ──────────────────────────────────────────────────

/** Parse "HH:MM" into minutes since midnight. */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** Get current time in "HH:MM" format using Europe/Madrid timezone. */
export function currentTimeStr(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Europe/Madrid',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const hour = parts.find(p => p.type === 'hour')?.value || '00';
  const minute = parts.find(p => p.type === 'minute')?.value || '00';
  return `${hour}:${minute}`;
}

/**
 * Format a Date as "HH:MM" in Europe/Madrid local time.
 */
export function formatLocalTime(d: Date): string {
  const parts = new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Europe/Madrid',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const hour = parts.find(p => p.type === 'hour')?.value || '00';
  const minute = parts.find(p => p.type === 'minute')?.value || '00';
  return `${hour}:${minute}`;
}

/** Get the Europe/Madrid timezone offset string (e.g., "+02:00" or "+01:00"). */
export function getMadridOffset(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Europe/Madrid',
    timeZoneName: 'shortOffset',
  }).formatToParts(now);
  const offset = parts.find(p => p.type === 'timeZoneName')?.value || '+02:00';
  // Normalize: "GMT+2" → "+02:00"
  if (offset.startsWith('GMT')) {
    const sign = offset[3];
    const num = parseInt(offset.slice(4), 10);
    return `${sign}${String(num).padStart(2, '0')}:00`;
  }
  // If already like "+02:00" or UTC
  if (offset === 'UTC') return '+00:00';
  return offset;
}

// ─── Schedules helpers ──────────────────────────────────────────────

interface SchedulesRaw {
  horarios_hardcoded: Record<string, Record<string, string[]>>;
}

let schedulesCache: SchedulesRaw | null = null;

/** Load schedules.json (cached in memory). */
export function loadSchedules(): SchedulesRaw {
  if (schedulesCache) return schedulesCache;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  schedulesCache = require(path.join(DATA_DIR, 'schedules.json')) as SchedulesRaw;
  return schedulesCache;
}
