import { z } from 'zod';

// Shared schemas
export const stopIdSchema = z.object({
  params: z.object({
    stop: z.string().regex(/^\d+$/, 'Stop ID must be a number').transform(Number),
  }),
});

export const lineIdSchema = z.object({
  params: z.object({
    line: z.string().min(1, 'Line is required'),
  }),
});

export const paginationSchema = z.object({
  query: z.object({
    limit: z.string().regex(/^\d+$/).default('50').transform(Number),
    offset: z.string().regex(/^\d+$/).default('0').transform(Number),
  }),
});

// Trip schemas
export const tripQuerySchema = z.object({
  query: z.object({
    from: z.string().regex(/^\d+$/, 'from stop ID must be a number').transform(Number),
    to: z.string().regex(/^\d+$/, 'to stop ID must be a number').transform(Number),
  }),
});

// Arrivals schemas
export const arrivalsQuerySchema = z.object({
  params: z.object({
    stop: z.string().regex(/^\d+$/, 'Stop ID must be a number').transform(Number),
  }),
  query: z.object({
    line: z.string().optional(),
    limit: z.string().regex(/^\d+$/).optional().transform(v => (v ? Number(v) : undefined)),
    refresh: z.enum(['true', 'false']).optional(),
  }),
});

// Schedules schemas
export const schedulesQuerySchema = z.object({
  params: z.object({
    line: z.string().min(1),
  }),
  query: z.object({
    day: z.enum(['weekday', 'saturday', 'holiday']).optional(),
    direction: z.enum(['forward', 'backward']).optional().default('forward'),
    limit: z.string().regex(/^\d+$/).optional().transform(v => (v ? Number(v) : undefined)),
  }),
});

export const stopSchedulesSchema = z.object({
  params: z.object({
    stop: z.string().regex(/^\d+$/, 'Stop ID must be a number').transform(Number),
  }),
  query: z.object({
    day: z.enum(['weekday', 'saturday', 'holiday']).optional(),
  }),
});

// Stops schemas
export const nearbyStopsSchema = z.object({
  query: z.object({
    lat: z.string().regex(/^-?\d+(\.\d+)?$/, 'lat must be a number').transform(Number),
    lng: z.string().regex(/^-?\d+(\.\d+)?$/, 'lng must be a number').transform(Number),
    radius: z.string().regex(/^\d+(\.\d+)?$/).optional().transform(v => (v ? Number(v) : undefined)),
    limit: z.string().regex(/^\d+$/).default('10').transform(Number),
  }),
});

export const searchStopsSchema = z.object({
  query: z.object({
    q: z.string().optional(),
    limit: z.string().regex(/^\d+$/).default('50').transform(Number),
    offset: z.string().regex(/^\d+$/).default('0').transform(Number),
  }),
});

