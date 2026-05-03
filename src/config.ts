import path from 'path';

export const OPEN_DATA_URL = 'https://datos.santander.es/api/rest/datasets/paradas_bus.json';
export const LEGACY_API_BASE = 'https://transitserver.miguelripoll23.deno.net';
export const INS4G_URL = 'http://158.179.210.240:7130';
export const INS4G_KEY = 'ik_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';

export const PORT = parseInt(process.env.PORT || '3000', 10);
export const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
export const VERSION = '3.0.0';
export const DISCOVERY_STOP_ID = 41;
export const NEARBY_RADIUS = 300;
export const BATCH_CONCURRENCY = 5;

export const CACHE_TTL = {
  stops: 60 * 60 * 1000,
  lines: 24 * 60 * 60 * 1000,
  routes: 60 * 1000,
  arrivals: 15 * 1000,
};

export const DATA_DIR = path.join(__dirname, '..', 'data');
