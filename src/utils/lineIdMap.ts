import * as gtfsDb from '../sources/gtfsDb';
import * as lineIndex from '../sources/lineIndex';
import logger from '../utils/logger';

let labelToIdMap = new Map<string, number>();
let idToLabelMap = new Map<number, string>();
let isInitialized = false;

/**
 * Initializes the line mapping from the GTFS database.
 * Falls back to lineIndex if GTFS Lines table is not available.
 */
export function initLineMap() {
  try {
    // Try GTFS database first
    const lines = gtfsDb.queryLines();
    labelToIdMap.clear();
    idToLabelMap.clear();

    for (const line of lines) {
      const label = line.shortName.replace(/['"]/g, '');
      const id = Number(line.lineId);
      labelToIdMap.set(label, id);
      idToLabelMap.set(id, label);
    }

    if (labelToIdMap.size > 0) {
      isInitialized = true;
      logger.info({ count: labelToIdMap.size }, '[lineIdMap] Initialized line mappings from GTFS');
      return;
    }

    logger.warn('[lineIdMap] GTFS Lines table empty, falling back to lineIndex');
  } catch (err) {
    logger.warn({ err }, '[lineIdMap] GTFS query failed, falling back to lineIndex');
  }

  // Fallback: populate from lineIndex
  try {
    const catalog = lineIndex.getLines();
    if (catalog && catalog.length > 0) {
      labelToIdMap.clear();
      idToLabelMap.clear();
      for (const line of catalog) {
        const label = line.id;
        const id = Number(line.schedule_id ?? line.id) || 0;
        if (id > 0) {
          labelToIdMap.set(label, id);
          idToLabelMap.set(id, label);
        }
      }
      if (labelToIdMap.size > 0) {
        isInitialized = true;
        logger.info({ count: labelToIdMap.size }, '[lineIdMap] Initialized line mappings from lineIndex fallback');
        return;
      }
    }
  } catch (err) {
    logger.error({ err }, '[lineIdMap] Failed to initialize from lineIndex fallback');
  }

  logger.warn('[lineIdMap] No line data available from any source');
}

/**
 * Resolves a public label (e.g. '1', 'LC') to its RedParsec numeric ID.
 */
export function resolveLineId(label: string): number | null {
  if (!isInitialized) initLineMap();
  return labelToIdMap.get(label) ?? null;
}

/**
 * Resolves a RedParsec numeric ID (e.g. 71) to its public label.
 */
export function resolveLineLabel(id: number): string | null {
  if (!isInitialized) initLineMap();
  return idToLabelMap.get(id) ?? null;
}

/**
 * Returns all known labels.
 */
export function getAllLabels(): string[] {
  if (!isInitialized) initLineMap();
  return Array.from(labelToIdMap.keys());
}
