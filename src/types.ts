// ─── Model Types ───────────────────────────────────────────────────

export interface Stop {
  stopId: number;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  sentido: string | null;
  lines: string[];
  source: 'open_data' | 'stops_min';
}

export interface LineInfo {
  id: string;
  name: string;
  color: string;
  text_color: string;
  schedule_id: string | null;
  destinations: { [dir: string]: string };
  directions: { [dir: string]: { destination: string; stops: number[] } };
  stats: { stops_total: number; stops_direction_1: number; stops_direction_2: number };
  has_schedule: boolean;
  active: boolean;
  is_circular: boolean;
}

export interface Arrival {
  line: string;
  destination: string;
  color: string;
  minutes: number | null;
  next: number | null;
  active: boolean;
}

export interface ArrivalWithStops extends Arrival {
  stops: { stopId: number; name: string; lat: number; lng: number }[];
}

export interface ApiError {
  error: string;
  message: string;
  source: string;
  timestamp: string;
}

// ─── Line Mapping ──────────────────────────────────────────────────

export interface LineMapping {
  publicId: string;
  legacyId: string;
  scheduleId: string | null;
  normalized: number;
}

// ─── Schedules ─────────────────────────────────────────────────────

export interface SchedulesRaw {
  horarios_hardcoded: Record<string, Record<string, string[]>>;
}
