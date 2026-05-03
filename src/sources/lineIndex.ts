// ─── Line Index — Builds a line catalog by discovering lines from the Legacy API ───
// Called once at startup (or when cache expires after CACHE_TTL.lines).
// Algorithm:
//   1. POST /api/v1/estimations/get-compact {stopId: 41} → allLineLabels
//   2. For each line, POST /api/v1/routes/get-compact × 2 (both directions)
//   3. Enrich with colors (colors.json) and schedule presence (schedules.json)
//   4. Cache in memory
//   5. Build precomputed indices (StopToLinesMap, StopPositionIndex, LineIntersectionIndex,
//      StopNameCache, circular detection)

import fetch from 'node-fetch';
import { LEGACY_API_BASE, DISCOVERY_STOP_ID, CACHE_TTL } from '../config';
import { LineInfo } from '../types';
import { toScheduleId, lineName, getTextColor } from '../utils/lineMapping';

// ── Static data ────────────────────────────────────────────────────
import colorsRaw from '../../data/colors.json';
import schedulesRaw from '../../data/schedules.json';
import stopsMinRaw from '../../data/stops.min.json';

// ── Types for Legacy API responses ─────────────────────────────────
interface RouteStopEntry {
  stopId: number;
  name: string;
  lines: string[];
}

// ── Helpers ────────────────────────────────────────────────────────

/** Convert RGB array to hex string: [255,0,0] → '#FF0000' */
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

function getColor(lineId: string): string {
  const colors = colorsRaw as Record<string, number[]>;
  const rgb = colors[lineId] || colors['default'];
  return rgbToHex(rgb);
}

function hasSchedule(lineId: string): boolean {
  const scheduleId = toScheduleId(lineId);
  if (!scheduleId) return false;
  const schedules = (schedulesRaw as any).horarios_hardcoded || {};
  return `${scheduleId}-1` in schedules || `${scheduleId}-2` in schedules;
}

// ── Legacy API calls ───────────────────────────────────────────────

/**
 * Fetch all line labels currently active at the discovery stop.
 * POST /api/v1/estimations/get-compact {stopId}
 * Response: [[arrivals...], [label1, label2, ...]]
 */
async function fetchAllLineLabels(stopId: number): Promise<string[]> {
  const url = `${LEGACY_API_BASE}/api/v1/estimations/get-compact`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stopId }),
  });
  if (!res.ok) throw new Error(`Legacy API /estimations/get-compact error: ${res.status}`);
  const data = (await res.json()) as any[];
  return data[1] || [];
}

/**
 * Fetch the route (ordered list of stops) for a given line from a given stop.
 * POST /api/v1/routes/get-compact {stopId, lineLabel}
 * Response: [[stopId, stopName, [lines...]], ...] or [] if stopId not on line.
 */
async function fetchRoute(stopId: number, line: string): Promise<RouteStopEntry[]> {
  const url = `${LEGACY_API_BASE}/api/v1/routes/get-compact`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stopId, lineLabel: line }),
  });
  if (!res.ok) throw new Error(`Legacy API /routes/get-compact error: ${res.status}`);
  const data = (await res.json()) as any[];
  if (!Array.isArray(data) || data.length === 0) return [];
  return data.map(
    (entry: any[]): RouteStopEntry => ({
      stopId: entry[0] as number,
      name: entry[1] as string,
      lines: entry[2] as string[],
    }),
  );
}

// ── In-memory cache ────────────────────────────────────────────────

let linesCache: Map<string, LineInfo> | null = null;
let lastBuilt: number = 0;

// ── Precomputed indices ────────────────────────────────────────────

/** stopId → Set of lineIds that pass through it */
let stopToLinesMap: Map<number, Set<string>> = new Map();

/** stopId → Map<lineId, Array<{dir: string, position: number}>> */
let stopPositionIndex: Map<number, Map<string, Array<{ dir: string; position: number }>>> = new Map();

/** "lineA|lineB" (alphabetically sorted) → array of common stopIds */
let lineIntersectionIndex: Map<string, number[]> = new Map();

/** stopId → name (populated from openData async + stops.min.json sync fallback) */
export const stopNameCache: Map<number, string> = new Map();

function isCacheValid(): boolean {
  return linesCache !== null && Date.now() - lastBuilt < CACHE_TTL.lines;
}

// ── Index builders ─────────────────────────────────────────────────

/**
 * Build StopToLinesMap: stopId → Set<lineId>
 */
function buildStopToLinesMap(catalog: Map<string, LineInfo>): Map<number, Set<string>> {
  const map = new Map<number, Set<string>>();

  for (const [lineId, line] of catalog) {
    for (const dir of Object.values(line.directions)) {
      for (const stopId of dir.stops) {
        let lineSet = map.get(stopId);
        if (!lineSet) {
          lineSet = new Set();
          map.set(stopId, lineSet);
        }
        lineSet.add(lineId);
      }
    }
  }

  return map;
}

/**
 * Build StopPositionIndex: stopId → Map<lineId, Array<{dir, position}>>
 * For each line, for each direction, for each stop at index i, record {dir, position: i}
 */
function buildStopPositionIndex(catalog: Map<string, LineInfo>): Map<number, Map<string, Array<{ dir: string; position: number }>>> {
  const index = new Map<number, Map<string, Array<{ dir: string; position: number }>>>();

  for (const [lineId, line] of catalog) {
    for (const [dir, direction] of Object.entries(line.directions)) {
      for (let i = 0; i < direction.stops.length; i++) {
        const stopId = direction.stops[i];

        let lineMap = index.get(stopId);
        if (!lineMap) {
          lineMap = new Map();
          index.set(stopId, lineMap);
        }

        let positions = lineMap.get(lineId);
        if (!positions) {
          positions = [];
          lineMap.set(lineId, positions);
        }

        positions.push({ dir, position: i });
      }
    }
  }

  return index;
}

/**
 * Build LineIntersectionIndex: "lineA|lineB" (sorted) → common stopIds[]
 * Used by the trip planner to avoid rebuilding Sets on every query.
 */
function buildLineIntersectionIndex(catalog: Map<string, LineInfo>): Map<string, number[]> {
  const lineStopSets = new Map<string, Set<number>>();

  // Build per-line stop sets
  for (const [lineId, line] of catalog) {
    const stopSet = new Set<number>();
    for (const dir of Object.values(line.directions)) {
      for (const stopId of dir.stops) {
        stopSet.add(stopId);
      }
    }
    lineStopSets.set(lineId, stopSet);
  }

  const lineIds = Array.from(catalog.keys());
  const intersections = new Map<string, number[]>();

  for (let i = 0; i < lineIds.length; i++) {
    const lineA = lineIds[i];
    const setA = lineStopSets.get(lineA)!;

    for (let j = i + 1; j < lineIds.length; j++) {
      const lineB = lineIds[j];
      const setB = lineStopSets.get(lineB)!;

      const common: number[] = [];
      for (const stopId of setA) {
        if (setB.has(stopId)) {
          common.push(stopId);
        }
      }

      if (common.length > 0) {
        // Key is alphabetically sorted to normalize order
        const sorted = [lineA, lineB].sort();
        const key = `${sorted[0]}|${sorted[1]}`;
        intersections.set(key, common);
      }
    }
  }

  return intersections;
}

/**
 * Detect circular lines.
 * A line is circular if:
 *   - In a single direction, the first stop equals the last stop, OR
 *   - directions[1].stops and directions[2].stops share >80% of stops
 */
function detectCircular(line: LineInfo): boolean {
  const dirs = Object.entries(line.directions);

  // Check: first stop equals last stop within the same direction
  for (const [, direction] of dirs) {
    const stops = direction.stops;
    if (stops.length >= 2 && stops[0] === stops[stops.length - 1]) {
      return true;
    }
  }

  // Check: directions share >80% of stops
  if (dirs.length >= 2) {
    const setA = new Set(dirs[0][1].stops);
    const setB = new Set(dirs[1][1].stops);

    if (setA.size === 0 || setB.size === 0) return false;

    let shared = 0;
    for (const s of setA) {
      if (setB.has(s)) shared++;
    }

    const overlapRatio = shared / Math.max(setA.size, setB.size);
    if (overlapRatio > 0.8) return true;
  }

  return false;
}

/**
 * Populate StopNameCache.
 * First pass: sync, from stops.min.json (fast, always available).
 * Second pass: async, from openData to override/complete names.
 */
function populateStopNameCacheSync(): void {
  const raw = stopsMinRaw as Record<string, any[]>;
  for (const [key, value] of Object.entries(raw)) {
    const stopId = parseInt(key, 10);
    if (isNaN(stopId)) continue;
    const name = value[3] as string | undefined;
    if (name) {
      stopNameCache.set(stopId, name);
    }
  }
}

async function populateStopNameCacheAsync(): Promise<void> {
  try {
    // Dynamic import to avoid circular dependency at module level
    const { getStops } = await import('./openData');
    const stops = await getStops();
    for (const stop of stops) {
      if (stop.name) {
        stopNameCache.set(stop.stopId, stop.name);
      }
    }
    console.log(`[lineIndex] Stop name cache updated with ${stops.length} openData stops`);
  } catch (err) {
    console.warn('[lineIndex] Could not load openData stops for name cache:', err);
  }
}

// ── Builder ────────────────────────────────────────────────────────

/**
 * Build (or refresh) the complete line catalog.
 * Safe to call multiple times — no-op if cache is still fresh.
 */
export async function buildLineIndex(): Promise<void> {
  if (isCacheValid()) return;

  console.log('[lineIndex] Building line catalog...');
  const allLineLabels = await fetchAllLineLabels(DISCOVERY_STOP_ID);
  console.log(`[lineIndex] Discovered ${allLineLabels.length} active line(s): ${allLineLabels.join(', ')}`);

  const newCache = new Map<string, LineInfo>();

  for (const lineId of allLineLabels) {
    try {
      // ── Direction 1: route from the discovery stop ──────────────
      const dir1Stops = await fetchRoute(DISCOVERY_STOP_ID, lineId);

      // ── Direction 2: route from the last stop of direction 1 ───
      let dir2Stops: RouteStopEntry[] = [];
      if (dir1Stops.length > 0) {
        const lastStopId = dir1Stops[dir1Stops.length - 1].stopId;
        if (lastStopId !== DISCOVERY_STOP_ID) {
          dir2Stops = await fetchRoute(lastStopId, lineId);
        }
      }

      // ── Build destinations and directions maps ─────────────────
      const destinations: { [dir: string]: string } = {};
      const directions: { [dir: string]: { destination: string; stops: number[] } } = {};

      if (dir1Stops.length > 0) {
        const dest = dir1Stops[dir1Stops.length - 1].name;
        destinations['1'] = dest;
        directions['1'] = {
          destination: dest,
          stops: dir1Stops.map((s) => s.stopId),
        };
      }

      if (dir2Stops.length > 0) {
        const dest = dir2Stops[dir2Stops.length - 1].name;
        destinations['2'] = dest;
        directions['2'] = {
          destination: dest,
          stops: dir2Stops.map((s) => s.stopId),
        };
      }

      const stopsDir1 = directions['1']?.stops.length || 0;
      const stopsDir2 = directions['2']?.stops.length || 0;
      const scheduleId = toScheduleId(lineId);

      const lineInfo: LineInfo = {
        id: lineId,
        name: lineName(lineId),
        color: getColor(lineId),
        text_color: getTextColor(lineId),
        schedule_id: scheduleId || null,
        destinations,
        directions,
        stats: {
          stops_total: stopsDir1 + stopsDir2,
          stops_direction_1: stopsDir1,
          stops_direction_2: stopsDir2,
        },
        has_schedule: hasSchedule(lineId),
        active: true,
        is_circular: false, // will be set after catalog is built
      };

      newCache.set(lineId, lineInfo);
      console.log(`[lineIndex]   ${lineId}: dir1=${stopsDir1} stops → "${destinations['1'] || '?'}", dir2=${stopsDir2} stops → "${destinations['2'] || '?'}"`);
    } catch (err) {
      console.error(`[lineIndex] Failed to build route for line "${lineId}":`, err);
    }
  }

  linesCache = newCache;

  // ── Circular detection: update is_circular on each line ────────
  for (const line of newCache.values()) {
    line.is_circular = detectCircular(line);
  }

  // ── Build precomputed indices ──────────────────────────────────
  stopToLinesMap = buildStopToLinesMap(newCache);
  stopPositionIndex = buildStopPositionIndex(newCache);
  lineIntersectionIndex = buildLineIntersectionIndex(newCache);

  // ── Populate stop name cache (sync fallback now, async later) ─
  if (stopNameCache.size === 0) {
    populateStopNameCacheSync();
  }

  lastBuilt = Date.now();
  console.log(`[lineIndex] Catalog ready: ${newCache.size} lines cached (TTL: ${CACHE_TTL.lines}ms)`);
  console.log(`[lineIndex] Indices built: StopToLinesMap=${stopToLinesMap.size} stops, IntersectionIndex=${lineIntersectionIndex.size} pairs`);

  // ── Fire-and-forget: update stop name cache from openData ─────
  populateStopNameCacheAsync().catch((err) => {
    console.warn('[lineIndex] Background stop name cache update failed:', err);
  });
}

// ── Public accessors ───────────────────────────────────────────────

/** Return all cached lines (empty array if catalog hasn't been built yet). */
export function getLines(): LineInfo[] {
  if (!linesCache) return [];
  return Array.from(linesCache.values());
}

/** Look up a single line by its public ID (e.g. "LC", "1", "N1"). */
export function getLine(id: string): LineInfo | undefined {
  return linesCache?.get(id);
}

/** Return every line that passes through the given stop (O(1) using StopToLinesMap). */
export function getLinesForStop(stopId: number): string[] {
  const lineSet = stopToLinesMap.get(stopId);
  return lineSet ? Array.from(lineSet) : [];
}

/** Return the ordered stop IDs for a given line and direction ("1" or "2"). */
export function getLineStops(line: string, direction: string): number[] {
  const info = linesCache?.get(line);
  if (!info) return [];
  return info.directions[direction]?.stops || [];
}

/** Return all lineIds passing through a stop (alias for getLinesForStop, O(1)). */
export function getStopLines(stopId: number): string[] {
  return getLinesForStop(stopId);
}

/** Return all positions (lineId, dir, position) for a given stop across all lines (O(1)). */
export function getStopPositions(stopId: number): Array<{ lineId: string; dir: string; position: number }> {
  const lineMap = stopPositionIndex.get(stopId);
  if (!lineMap) return [];

  const results: Array<{ lineId: string; dir: string; position: number }> = [];
  for (const [lineId, positions] of lineMap) {
    for (const pos of positions) {
      results.push({
        lineId,
        dir: pos.dir,
        position: pos.position,
      });
    }
  }
  return results;
}

/** Return common stopIds between two lines (O(1), alphabetically sorted key). */
export function getCommonStops(lineA: string, lineB: string): number[] {
  const sorted = [lineA, lineB].sort();
  const key = `${sorted[0]}|${sorted[1]}`;
  return lineIntersectionIndex.get(key) || [];
}

/** Look up a stop's name from the precomputed cache (sync from stops.min.json, async from openData). */
export function getStopName(stopId: number): string | null {
  return stopNameCache.get(stopId) ?? null;
}

/** Return a Map<stopId, position> for a specific line and direction (O(1)). */
export function getLinePositionMap(lineId: string, dir: string): Map<number, number> | null {
  const lineInfo = linesCache.get(lineId);
  if (!lineInfo) return null;
  const dirData = lineInfo.directions[dir];
  if (!dirData) return null;
  const map = new Map<number, number>();
  dirData.stops.forEach((sid, i) => map.set(sid, i));
  return map;
}
