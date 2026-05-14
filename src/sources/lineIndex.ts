// ─── Line Index — Builds a line catalog from the GTFS SQLite database ───
// Replaces the discovery logic from Legacy API.
// Algorithm:
//   1. Query gtfsDb.queryLines() to get all lines.
//   2. For each line, query gtfsDb.queryStopTimesForLine() to get ordered stops.
//   3. Enrich with colors (directly from GTFS) and schedule info.
//   4. Cache in memory and persist to Redis.
//   5. Build precomputed indices (StopToLinesMap, StopPositionIndex, LineIntersectionIndex,
//      StopNameCache, circular detection, LinePositionMaps)

import { CACHE_TTL } from '../config';
import { LineInfo } from '../types';
import { toScheduleId, lineName, getTextColor } from '../utils/lineMapping';
import { getColor } from '../utils/helpers';
import logger from '../utils/logger';
import * as cacheDb from './cacheDb';
import * as gtfsDb from './gtfsDb';
import * as lineIdMap from '../utils/lineIdMap';

// ── Static data fallback ───────────────────────────────────────────
import schedulesRaw from '../../data/schedules.json';

// ── Helpers ────────────────────────────────────────────────────────

function hasSchedule(lineId: string): boolean {
  const scheduleId = toScheduleId(lineId);
  if (!scheduleId) return false;
  const schedulesRawTyped = schedulesRaw as { horarios_hardcoded?: Record<string, unknown> };
  const schedules = schedulesRawTyped.horarios_hardcoded || {};
  return `${scheduleId}-1` in schedules || `${scheduleId}-2` in schedules;
}

// ── In-memory cache (L1) ───────────────────────────────────────────

let linesCache: Map<string, LineInfo> | null = null;
let lastBuilt: number = 0;

// Used to prevent concurrent rebuilds
let isBuilding = false;
let buildPromise: Promise<void> | null = null;
let refreshInterval: NodeJS.Timeout | null = null;

// ── Precomputed indices ────────────────────────────────────────────

let stopToLinesMap: Map<number, Set<string>> = new Map();
let stopPositionIndex: Map<number, Map<string, Array<{ dir: string; position: number }>>> = new Map();
let lineIntersectionIndex: Map<string, number[]> = new Map();
let linePositionMaps: Map<string, Map<string, Map<number, number>>> = new Map();

export const stopNameCache: Map<number, string> = new Map();
export const stopCoordsCache: Map<number, { lat: number; lng: number }> = new Map();

// ── Index builders ─────────────────────────────────────────────────

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

function buildLineIntersectionIndex(catalog: Map<string, LineInfo>): Map<string, number[]> {
  const lineStopSets = new Map<string, Set<number>>();
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
        if (setB.has(stopId)) common.push(stopId);
      }
      if (common.length > 0) {
        const sorted = [lineA, lineB].sort();
        intersections.set(`${sorted[0]}|${sorted[1]}`, common);
      }
    }
  }
  return intersections;
}

function buildLinePositionMaps(catalog: Map<string, LineInfo>): Map<string, Map<string, Map<number, number>>> {
  const maps = new Map<string, Map<string, Map<number, number>>>();
  for (const [lineId, line] of catalog) {
    const dirMaps = new Map<string, Map<number, number>>();
    for (const [dir, direction] of Object.entries(line.directions)) {
      const posMap = new Map<number, number>();
      direction.stops.forEach((sid, i) => posMap.set(sid, i));
      dirMaps.set(dir, posMap);
    }
    maps.set(lineId, dirMaps);
  }
  return maps;
}

function detectCircular(line: LineInfo): boolean {
  const dirs = Object.entries(line.directions);
  for (const [, direction] of dirs) {
    const stops = direction.stops;
    if (stops.length >= 2 && stops[0] === stops[stops.length - 1]) return true;
  }
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

function populateStopNameAndCoordsFromGtfs(): void {
  try {
    const stops = gtfsDb.queryStops();
    for (const stop of stops) {
      stopNameCache.set(stop.stopId, stop.name);
      stopCoordsCache.set(stop.stopId, { lat: stop.lat, lng: stop.lon });
    }
    logger.info({ count: stops.length }, '[lineIndex] Stop names & coords populated from GTFS');
  } catch (err) {
    logger.error({ err }, '[lineIndex] Failed to populate stops from GTFS');
  }
}

// ── Builder ────────────────────────────────────────────────────────

/**
 * Rebuild the line catalog from the GTFS database and save to Redis.
 */
async function performLineIndexBuild(): Promise<void> {
  if (isBuilding) return;
  isBuilding = true;
  
  try {
    logger.info('[lineIndex] Building line catalog from GTFS SQLite...');
    
    // 1. Initialize Line ID Map
    lineIdMap.initLineMap();
    
    // 2. Query all lines from GTFS
    const gtfsLines = gtfsDb.queryLines();
    const newCache = new Map<string, LineInfo>();

    for (const gl of gtfsLines) {
      try {
        const lineLabel = gl.shortName.replace(/['"]/g, '');
        const lineId = Number(gl.lineId);

        // 3. Get ordered stops for this line
        const stopTimes = gtfsDb.queryStopTimesForLine(lineId);
        
        const destinations: { [dir: string]: string } = {};
        const directions: { [dir: string]: { destination: string; stops: number[] } } = {};

        // Group stop times by direction (direction_id is string '0' or '1' in SQLite Trips table)
        const stopsByDir = new Map<string, number[]>();
        
        // We also need the destination name for each direction
        // In our schema, Trips has a destination field. 
        // We'll just take the destination from the first trip we find for each direction.
        const db = gtfsDb.openDb();
        const tripDirs = db.prepare('SELECT direction, destination FROM Trips WHERE lineId = ? GROUP BY direction').all(lineId) as { direction: number, destination: string }[];
        
        for (const td of tripDirs) {
          const dirId = String(td.direction) === '0' ? '1' : '2'; // Map '0'/'1' to '1'/'2'
          const stops = stopTimes
            .filter(st => String(st.direction_id) === String(td.direction))
            // Dedup stops in case multiple trips are returned
            .map(st => st.stop_id);
          
          // Dedup while keeping order (using first trip sequence)
          const uniqueStops: number[] = [];
          const seen = new Set<number>();
          // Find first tripId for this direction to get a clean sequence
          const firstTrip = stopTimes.find(st => String(st.direction_id) === String(td.direction))?.trip_id;
          if (firstTrip) {
            const tripStops = stopTimes.filter(st => st.trip_id === firstTrip).map(st => st.stop_id);
            directions[dirId] = { destination: td.destination, stops: tripStops };
            destinations[dirId] = td.destination;
          }
        }

        const stopsDir1 = directions['1']?.stops.length || 0;
        const stopsDir2 = directions['2']?.stops.length || 0;
        
        // Use color from GTFS, add # if missing
        let color = gl.color;
        if (color && !color.startsWith('#')) color = '#' + color;
        if (!color) color = getColor(lineLabel);

        const lineInfo: LineInfo = {
          id: lineLabel,
          name: lineName(lineLabel),
          color: color,
          text_color: getTextColor(lineLabel),
          schedule_id: toScheduleId(lineLabel) || null,
          destinations,
          directions,
          stats: {
            stops_total: stopsDir1 + stopsDir2,
            stops_direction_1: stopsDir1,
            stops_direction_2: stopsDir2,
          },
          has_schedule: hasSchedule(lineLabel),
          active: true,
          is_circular: false,
        };

        newCache.set(lineLabel, lineInfo);
      } catch (err) {
        logger.error({ err, gl }, `[lineIndex] Failed to build route for line`);
      }
    }

    for (const line of newCache.values()) {
      line.is_circular = detectCircular(line);
    }

    // Assign to RAM L1
    linesCache = newCache;
    stopToLinesMap = buildStopToLinesMap(newCache);
    stopPositionIndex = buildStopPositionIndex(newCache);
    lineIntersectionIndex = buildLineIntersectionIndex(newCache);
    linePositionMaps = buildLinePositionMaps(newCache);

    populateStopNameAndCoordsFromGtfs();

    // Build the transit graph for the Trip Planner
    const { buildGraph } = await import('../services/transitGraph');
    buildGraph(newCache);

    lastBuilt = Date.now();
    
    logger.info(`[lineIndex] Catalog rebuilt from GTFS: ${newCache.size} lines.`);
    
    // Persist to Redis (L2)
    try {
      await cacheDb.setLineCatalog(newCache);
      await cacheDb.setIndices(stopToLinesMap, lineIntersectionIndex, linePositionMaps);
      await cacheDb.setMetadata('last_line_build', lastBuilt.toString());
      logger.info('[lineIndex] Persisted catalog and indices to Redis.');
    } catch (err) {
      logger.warn({ err }, '[lineIndex] Failed to persist to Redis');
    }

  } finally {
    isBuilding = false;
  }
}

/**
 * Fast check. Used in HTTP requests. Returns immediately if data is in RAM or Redis.
 * Only blocks on a full cold start.
 */
export async function ensureLineIndex(): Promise<void> {
  // L1: RAM Cache
  if (linesCache && linesCache.size > 0) return;

  // Wait if it's already building from a cold start
  if (buildPromise) {
    await buildPromise;
    return;
  }

  buildPromise = (async () => {
    // L2: Redis Cache
    const redisLines = await cacheDb.getLineCatalog();
    const redisIndices = await cacheDb.getIndices();
    const redisLastBuilt = await cacheDb.getMetadata('last_line_build');

    if (redisLines && redisIndices && redisLastBuilt) {
      linesCache = redisLines;
      stopToLinesMap = redisIndices.stopToLines;
      lineIntersectionIndex = redisIndices.intersections;
      linePositionMaps = redisIndices.positions;
      stopPositionIndex = buildStopPositionIndex(redisLines);
      lastBuilt = parseInt(redisLastBuilt, 10);
      
      populateStopNameAndCoordsFromGtfs();
      
      logger.info('[lineIndex] Loaded catalog from Redis successfully.');
      return;
    }

    // L3: Cold Start (Build from GTFS)
    logger.warn('[lineIndex] Cache miss. Building from GTFS...');
    await performLineIndexBuild();
  })();

  try {
    await buildPromise;
  } finally {
    buildPromise = null;
  }
}

/**
 * Starts a background interval to refresh the catalog every 24h.
 * Synchronized with GTFS refresh.
 */
/**
 * Starts a background interval to refresh the catalog.
 * It will check for GTFS updates and rebuild the index if needed.
 */
export function startBackgroundRefresh(): void {
  if (refreshInterval) clearInterval(refreshInterval);
  refreshInterval = setInterval(async () => {
    try {
      logger.info('[lineIndex] Checking for updates (GTFS + Catalog)...');
      
      // 1. Check for GTFS update
      const gtfsUpdated = await gtfsDb.downloadGtfsIfStale();
      
      // 2. Rebuild if GTFS was updated or if RAM cache is somehow empty
      if (gtfsUpdated || !linesCache || linesCache.size === 0) {
        await performLineIndexBuild();
      } else {
        logger.info('[lineIndex] No GTFS update detected. Skipping rebuild.');
      }
    } catch (err) {
      logger.error({ err }, '[lineIndex] Background refresh failed');
    }
  }, CACHE_TTL.lines);
}

// ── Public accessors ───────────────────────────────────────────────

export function getLines(): LineInfo[] {
  if (!linesCache) return [];
  return Array.from(linesCache.values());
}

export function getLine(id: string): LineInfo | undefined {
  return linesCache?.get(id);
}

export function getLinesForStop(stopId: number): string[] {
  const lineSet = stopToLinesMap.get(stopId);
  return lineSet ? Array.from(lineSet) : [];
}

export function getLineStops(line: string, direction: string): number[] {
  const info = linesCache?.get(line);
  if (!info) return [];
  return info.directions[direction]?.stops || [];
}

export function getStopLines(stopId: number): string[] {
  return getLinesForStop(stopId);
}

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

export function getCommonStops(lineA: string, lineB: string): number[] {
  const sorted = [lineA, lineB].sort();
  const key = `${sorted[0]}|${sorted[1]}`;
  return lineIntersectionIndex.get(key) || [];
}

export function getStopName(stopId: number): string | null {
  return stopNameCache.get(stopId) ?? null;
}

export function getLinePositionMap(lineId: string, dir: string): Map<number, number> | null {
  const dirMaps = linePositionMaps.get(lineId);
  if (!dirMaps) return null;
  const posMap = dirMaps.get(dir);
  return posMap ?? null;
}
