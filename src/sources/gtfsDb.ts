import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import Database from 'better-sqlite3';
import { 
  TUS_GTFS_URL, 
  TUS_NATIVE_AUTH, 
  GTFS_DB_PATH, 
  GTFS_TIMESTAMP_KEY,
  CACHE_TTL,
  DATA_DIR
} from '../config';
import * as cacheDb from './cacheDb';
import logger from '../utils/logger';

let dbInstance: Database.Database | null = null;
let dbPath: string = GTFS_DB_PATH;

/**
 * Ensures DATA_DIR exists
 */
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Formats a Date object to yyyyMMddHHmmss in GMT
 */
function formatGtfsTimestamp(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    date.getUTCFullYear().toString() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds())
  );
}

/**
 * Downloads the GTFS SQLite database if it's stale or missing.
 * Uses the 'current' query param and Last-Modified header for synchronization.
 */
export async function downloadGtfsIfStale(): Promise<boolean> {
  ensureDataDir();
  
  const currentTimestamp = await cacheDb.getMetadata(GTFS_TIMESTAMP_KEY) || '20180630000001';
  const fileExists = fs.existsSync(dbPath);

  logger.info({ currentTimestamp, fileExists }, '[gtfsDb] Checking for GTFS updates...');

  try {
    const url = `${TUS_GTFS_URL}?current=${currentTimestamp}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': TUS_NATIVE_AUTH,
      },
    });

    if (res.status === 304) {
      logger.info('[gtfsDb] GTFS database is already up to date (304)');
      return false;
    }

    if (!res.ok) {
      // If the server returns 404 but we have a local file, we might be okay
      if (res.status === 404 && fileExists) {
        logger.warn('[gtfsDb] GTFS endpoint returned 404, using local cache');
        return false;
      }
      throw new Error(`Failed to download GTFS: ${res.status} ${res.statusText}`);
    }

    // Success - download the file
    const dest = fs.createWriteStream(dbPath);
    await new Promise<void>((resolve, reject) => {
      res.body.pipe(dest);
      res.body.on('error', reject);
      dest.on('finish', () => resolve());
      dest.on('error', reject);
    });

    // Extract Last-Modified to save for next time
    const lastModified = res.headers.get('last-modified');
    if (lastModified) {
      const date = new Date(lastModified);
      const newTimestamp = formatGtfsTimestamp(date);
      await cacheDb.setMetadata(GTFS_TIMESTAMP_KEY, newTimestamp);
      logger.info({ newTimestamp }, '[gtfsDb] GTFS database updated successfully');
    } else {
      logger.warn('[gtfsDb] Downloaded GTFS but no Last-Modified header found');
    }

    // Close old connection if exists
    if (dbInstance) {
      dbInstance.close();
      dbInstance = null;
    }

    return true;
  } catch (err) {
    logger.error({ err }, '[gtfsDb] Error during GTFS download');
    if (!fileExists) {
      throw new Error('GTFS database is missing and download failed');
    }
    return false;
  }
}

/**
 * Opens and returns the SQLite database instance.
 * Reuses instance if already open.
 */
export function openDb(): Database.Database {
  if (dbInstance) return dbInstance;

  if (!fs.existsSync(dbPath)) {
    throw new Error('GTFS database file not found. Call downloadGtfsIfStale first.');
  }

  dbInstance = new Database(dbPath, { readonly: true });
  // Performance optimizations for SQLite (best-effort, may fail on readonly filesystems)
  try { dbInstance.pragma('journal_mode = WAL'); } catch (_) { /* readonly filesystem */ }
  try { dbInstance.pragma('synchronous = OFF'); } catch (_) { /* readonly filesystem */ }
  
  return dbInstance;
}

// ─── Queries ────────────────────────────────────────────────────────

export interface GtfsStop {
  stopId: number;
  name: string;
  lat: number;
  lon: number;
}

export function queryStops(): GtfsStop[] {
  const db = openDb();
  return db.prepare('SELECT stopId, name, latitude as lat, longitude as lon FROM Stops').all() as GtfsStop[];
}

export interface GtfsLine {
  lineId: number;
  shortName: string;
  longName: string;
  color: string;
  textColor: string;
}

export function queryLines(): GtfsLine[] {
  const db = openDb();
  return db.prepare('SELECT lineId, shortName, longName, color, NULL as textColor FROM Lines').all() as GtfsLine[];
}

export function queryStopLines(): { stopId: number; lineId: number }[] {
  const db = openDb();
  return db.prepare('SELECT stopId, lineId FROM StopLines').all() as { stopId: number; lineId: number }[];
}

export interface GtfsStopTime {
  trip_id: number;
  stop_id: number;
  stop_sequence: number;
  departure_time: string;
  direction_id: number;
}

export function queryStopTimesForLine(lineId: number): GtfsStopTime[] {
  const db = openDb();
  // Note: the schema in LatexDOC shows Trips has lineId and direction (string '0'/'1')
  // We'll join StopsTimes with Trips to get everything needed for a line
  return db.prepare(`
    SELECT st.tripId as trip_id, st.stopId as stop_id, st.sequence as stop_sequence, 
           st.time as departure_time, t.direction as direction_id
    FROM StopTimes st
    JOIN Trips t ON st.tripId = t.tripId
    WHERE t.lineId = ?
    ORDER BY t.direction, st.sequence
  `).all(lineId) as GtfsStopTime[];
}

/**
 * Query all stop times for a specific date.
 */
export function queryStopTimesForDate(date: string, lineId?: number, stopId?: number): GtfsStopTime[] {
  const db = openDb();
  let sql = `
    SELECT st.tripId as trip_id, st.stopId as stop_id, st.sequence as stop_sequence, 
           st.time as departure_time, t.direction as direction_id
    FROM CalendarDates cd
    JOIN Trips t ON cd.calendarId = t.calendarId
    JOIN StopTimes st ON t.tripId = st.tripId
    WHERE cd.date = ?
  `;
  const params: any[] = [date];
  
  if (lineId) {
    sql += ' AND t.lineId = ?';
    params.push(lineId);
  }
  if (stopId) {
    sql += ' AND st.stop_id = ?';
    params.push(stopId);
  }
  
  sql += ' ORDER BY st.time ASC';
  return db.prepare(sql).all(...params) as GtfsStopTime[];
}


