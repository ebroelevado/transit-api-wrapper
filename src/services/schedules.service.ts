import { dayTypeName } from '../utils/lineMapping';
import { getLinesForStop } from '../sources/lineIndex';
import { timeToMinutes, currentTimeStr, timeFromGtfsDateTime } from '../utils/helpers';
import * as gtfsDb from '../sources/gtfsDb';
import * as lineIdMap from '../utils/lineIdMap';
import logger from '../utils/logger';

/** Calculate approximate headway in minutes from sorted time array */
function calcFrequency(times: string[]): number | null {
  if (times.length < 2) return null;
  let totalGap = 0;
  let gaps = 0;
  for (let i = 1; i < times.length; i++) {
    let gap = timeToMinutes(times[i]) - timeToMinutes(times[i - 1]);
    if (gap < 0) gap += 1440; // Handle crossing midnight
    if (gap > 0 && gap < 120) {
      totalGap += gap;
      gaps++;
    }
  }
  return gaps > 0 ? Math.round(totalGap / gaps) : null;
}

/** 
 * Finds a representative date for a day type (laborable, sabado, domingo).
 * Currently just returns today's date in YYYY-MM-DD format.
 */
function getRepresentativeDate(day: string): string {
  const now = new Date();
  // Simple heuristic: if day is 'domingo' and today is not Sunday, find next Sunday.
  // For now, we'll just return today's ISO date string.
  return now.toISOString().split('T')[0];
}

export async function fetchLineSchedules(lineLabel: string, direction: string, day: string) {
  const lineId = lineIdMap.resolveLineId(lineLabel);
  if (!lineId) return { error: 'line_not_found' };

  const date = getRepresentativeDate(day);
  const stopTimes = gtfsDb.queryStopTimesForDate(date, lineId);
  
  // Map direction '1'/'2' to GTFS '0'/'1'
  const gtfsDir = direction === '1' ? '0' : '1';
  
  // Get unique times for the ORIGIN (stop_sequence = 1)
  const originTimes = stopTimes
    .filter(st => String(st.direction_id) === gtfsDir && st.stop_sequence === 1)
    .map(st => timeFromGtfsDateTime(st.departure_time));

  if (originTimes.length === 0) {
    return { error: 'not_found', date, day };
  }

  const frequency = calcFrequency(originTimes);

  return {
    line: lineLabel,
    direction,
    day,
    date,
    day_name: dayTypeName(day),
    times: originTimes,
    total: originTimes.length,
    first: originTimes[0],
    last: originTimes[originTimes.length - 1],
    frequency_min: frequency,
    source: 'gtfs',
  };
}

export async function fetchNextService(lineLabel: string, direction: string, day: string) {
  const lineId = lineIdMap.resolveLineId(lineLabel);
  if (!lineId) return { error: 'line_not_found' };

  const date = getRepresentativeDate(day);
  const stopTimes = gtfsDb.queryStopTimesForDate(date, lineId);
  const gtfsDir = direction === '1' ? '0' : '1';

  const originTimes = stopTimes
    .filter(st => String(st.direction_id) === gtfsDir && st.stop_sequence === 1)
    .map(st => timeFromGtfsDateTime(st.departure_time));

  if (originTimes.length === 0) {
    return { error: 'not_found', date };
  }

  const now = currentTimeStr();
  const nowMinutes = timeToMinutes(now);
  const normalizedNow = nowMinutes < 240 ? nowMinutes + 1440 : nowMinutes;

  let nextTime: string | null = null;
  let nextMinutes: number | null = null;

  for (const t of originTimes) {
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
      line: lineLabel, direction, day, now, next: null, status: 'service_ended',
      message: 'No hay más servicios programados para hoy',
    };
  }

  const minutesFromNow = nextMinutes! - normalizedNow;

  return {
    line: lineLabel, direction, day, now,
    next: { time: nextTime, minutes_from_now: minutesFromNow },
    status: 'active',
  };
}

export async function fetchStopSchedules(stopId: number, day: string) {
  const lineLabels = getLinesForStop(stopId);
  const date = getRepresentativeDate(day);

  if (lineLabels.length === 0) {
    return { stop: stopId, schedules: [], total: 0, source: 'gtfs' };
  }

  const results: any[] = [];

  for (const label of lineLabels) {
    const lineId = lineIdMap.resolveLineId(label);
    if (!lineId) continue;

    for (const dir of ['1', '2']) {
      const gtfsDir = dir === '1' ? '0' : '1';
      const stopTimes = gtfsDb.queryStopTimesForDate(date, lineId, stopId);
      const times = stopTimes
        .filter(st => String(st.direction_id) === gtfsDir)
        .map(st => timeFromGtfsDateTime(st.departure_time));

      if (times.length === 0) continue;

      results.push({
        line: label,
        direction: dir,
        day,
        date,
        day_name: dayTypeName(day),
        first: times[0],
        last: times[times.length - 1],
        frequency_min: calcFrequency(times),
        times,
      });
    }
  }

  return { stop: stopId, schedules: results, total: results.length, source: 'gtfs' };
}

export async function getNextDepartureFromOrigin(lineLabel: string, direction: string, day: string, fromMinutes: number): Promise<number | null> {
  const lineId = lineIdMap.resolveLineId(lineLabel);
  if (!lineId) return null;

  const date = getRepresentativeDate(day);
  const gtfsDir = direction === '1' ? '0' : '1';
  
  const stopTimes = gtfsDb.queryStopTimesForDate(date, lineId);
  const originTimes = stopTimes
    .filter(st => String(st.direction_id) === gtfsDir && st.stop_sequence === 1)
    .map(st => timeFromGtfsDateTime(st.departure_time));

  if (originTimes.length === 0) return null;

  const normalizedFrom = fromMinutes < 240 ? fromMinutes + 1440 : fromMinutes;

  for (const t of originTimes) {
    const tMin = timeToMinutes(t);
    const normalizedT = tMin < 240 ? tMin + 1440 : tMin;
    if (normalizedT >= normalizedFrom) {
      return normalizedT;
    }
  }

  return null;
}
