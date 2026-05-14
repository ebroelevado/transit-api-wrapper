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

  // Last resort: hardcoded mappings (same as Android LineIDMapper)
  const knownLines: Record<string, number> = {
    '1': 1, '2': 2, '3': 3, '4': 4, '11': 11, '12': 12, '13': 13,
    '14': 14, '15': 15, '16': 16, '17': 17, '18': 18,
    'LC': 100, 'N1': 101, 'N2': 102, 'N3': 103,
    'E1': 41, 'E2': 42, 'E3': 43, 'E4': 44, 'E7': 47, 'E31': 31,
    '5C1': 51, '5C2': 52, '6C1': 61, '6C2': 62,
    '7C1': 71, '7C2': 72, '24C1': 241, '24C2': 242,
    'SE': 40, '99': 99
  };
  for (const [label, id] of Object.entries(knownLines)) {
    labelToIdMap.set(label, id);
    idToLabelMap.set(id, label);
  }
  isInitialized = true;
  logger.warn({ count: Object.keys(knownLines).length }, '[lineIdMap] Using hardcoded line mappings as last resort');
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
