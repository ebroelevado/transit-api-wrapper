import { toScheduleId, dayTypeName } from '../utils/lineMapping';
import { getLinesForStop } from '../sources/lineIndex';
import { timeToMinutes, currentTimeStr, loadSchedules } from '../utils/helpers';

/** Build the lookup key: "{scheduleId}-{direction}" */
function scheduleKey(lineId: string, direction: string): string | null {
  const sId = toScheduleId(lineId);
  if (!sId) return null;
  return `${sId}-${direction}`;
}

/** Calculate approximate headway in minutes from sorted time array */
function calcFrequency(times: string[]): number | null {
  if (times.length < 2) return null;
  let totalGap = 0;
  let gaps = 0;
  for (let i = 1; i < times.length; i++) {
    let gap = timeToMinutes(times[i]) - timeToMinutes(times[i - 1]);
    if (gap < 0) gap += 1440; // Handle crossing midnight
    if (gap > 0 && gap < 120) {
      // ignore unreasonable gaps (e.g. night buses)
      totalGap += gap;
      gaps++;
    }
  }
  return gaps > 0 ? Math.round(totalGap / gaps) : null;
}

export function fetchLineSchedules(line: string, direction: string, day: string) {
  const key = scheduleKey(line, direction);
  if (!key) return { error: 'not_available' };

  const schedules = loadSchedules().horarios_hardcoded;
  const entry = schedules[key];

  if (!entry || !entry[day] || entry[day].length === 0) {
    return { error: 'not_found', key };
  }

  const times = entry[day];
  const frequency = calcFrequency(times);

  return {
    line,
    direction,
    day,
    day_name: dayTypeName(day),
    times,
    total: times.length,
    first: times[0],
    last: times[times.length - 1],
    frequency_min: frequency,
    source: 'static',
  };
}

export function fetchNextService(line: string, direction: string, day: string) {
  const key = scheduleKey(line, direction);
  if (!key) return { error: 'not_available' };

  const schedules = loadSchedules().horarios_hardcoded;
  const entry = schedules[key];

  if (!entry || !entry[day] || entry[day].length === 0) {
    return { error: 'not_found', key };
  }

  const times = entry[day];
  const now = currentTimeStr();
  const nowMinutes = timeToMinutes(now);
  const normalizedNow = nowMinutes < 240 ? nowMinutes + 1440 : nowMinutes;

  let nextTime: string | null = null;
  let nextMinutes: number | null = null;

  for (const t of times) {
    const tMin = timeToMinutes(t);
    const normalizedT = tMin < 240 ? tMin + 1440 : tMin;
    if (normalizedT >= normalizedNow) {
      nextTime = t;
      nextMinutes = normalizedT;
      break;
    }
  }

  if (!nextTime) {
    return {
      line, direction, day, now, next: null, status: 'service_ended',
      message: 'No hay más servicios programados para hoy',
    };
  }

  const minutesFromNow = nextMinutes! - normalizedNow;

  return {
    line, direction, day, now,
    next: { time: nextTime, minutes_from_now: minutesFromNow },
    status: 'active',
  };
}

export function fetchStopSchedules(stopId: number, day: string) {
  const lineIds = getLinesForStop(stopId);

  if (lineIds.length === 0) {
    return { stop: stopId, schedules: [], total: 0, source: 'static' };
  }

  const schedules = loadSchedules().horarios_hardcoded;
  const results: any[] = [];

  for (const lineId of lineIds) {
    for (const dir of ['1', '2']) {
      const key = scheduleKey(lineId, dir);
      if (!key) continue;
      const entry = schedules[key];
      if (!entry || !entry[day] || entry[day].length === 0) continue;

      const times = entry[day];
      results.push({
        line: lineId,
        direction: dir,
        day,
        day_name: dayTypeName(day),
        first: times[0],
        last: times[times.length - 1],
        frequency_min: calcFrequency(times),
        times,
      });
    }
  }

  return { stop: stopId, schedules: results, total: results.length, source: 'static' };
}

export function getNextDepartureFromOrigin(line: string, direction: string, day: string, fromMinutes: number): number | null {
  const key = scheduleKey(line, direction);
  if (!key) return null;

  const schedules = loadSchedules().horarios_hardcoded;
  const entry = schedules[key];

  if (!entry || !entry[day] || entry[day].length === 0) return null;

  const times = entry[day];
  const normalizedFrom = fromMinutes < 240 ? fromMinutes + 1440 : fromMinutes;

  for (const t of times) {
    const tMin = timeToMinutes(t);
    const normalizedT = tMin < 240 ? tMin + 1440 : tMin;
    if (normalizedT >= normalizedFrom) {
      return normalizedT;
    }
  }

  return null;
}
