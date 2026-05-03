import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/index';

describe('GET /api/v1/stops/nearby', () => {
  it('should require lat and lng', async () => {
    const res = await request(app).get('/api/v1/stops/nearby');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should handle limit=0 properly (not fallback to 10)', async () => {
    // Valid lat/lng in Santander
    const res = await request(app).get('/api/v1/stops/nearby?lat=43.462&lng=-3.819&limit=0');
    expect(res.status).toBe(200);
    // Since limit=0, it should return 0 results
    expect(res.body.results).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });
  
  it('should handle missing limit by defaulting to 10', async () => {
    const res = await request(app).get('/api/v1/stops/nearby?lat=43.462&lng=-3.819');
    expect(res.status).toBe(200);
    // Since limit is omitted, it should return max 10
    expect(res.body.results.length).toBeLessThanOrEqual(10);
  });
});

describe('GET /api/v1/stops/:stop', () => {
  it('should return 404 for non-existent stop', async () => {
    const res = await request(app).get('/api/v1/stops/999999');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('STOP_NOT_FOUND');
  }, 10000);

  it('should return 400 for invalid stop id', async () => {
    const res = await request(app).get('/api/v1/stops/invalid_id');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
