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
    const gap = timeToMinutes(times[i]) - timeToMinutes(times[i - 1]);
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

  let nextTime: string | null = null;
  for (const t of times) {
    if (timeToMinutes(t) >= nowMinutes) {
      nextTime = t;
      break;
    }
  }

  if (!nextTime) {
    return {
      line, direction, day, now, next: null, status: 'service_ended',
      message: 'No hay más servicios programados para hoy',
    };
  }

  const minutesFromNow = timeToMinutes(nextTime) - nowMinutes;

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
