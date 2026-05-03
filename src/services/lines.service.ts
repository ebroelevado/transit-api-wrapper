import * as lineIndex from '../sources/lineIndex';
import * as openData from '../sources/openData';
import { toScheduleId } from '../utils/lineMapping';
import { resolveStop } from '../utils/helpers';

export async function getLines() {
  await lineIndex.buildLineIndex();
  const lines = lineIndex.getLines();
  return lines.map(l => ({
    id: l.id,
    name: l.name,
    color: l.color,
    text_color: l.text_color,
    destinations: Object.values(l.destinations),
    stops: l.stats.stops_total,
    has_schedule: l.has_schedule,
    active: l.active,
  }));
}

export async function getLineDetail(lineId: string) {
  await lineIndex.buildLineIndex();
  const line = lineIndex.getLine(lineId);
  if (!line) return null;

  return {
    id: line.id,
    name: line.name,
    color: line.color,
    text_color: line.text_color,
    schedule_id: toScheduleId(line.id) || null,
    destinations: line.destinations,
    stats: line.stats,
    has_schedule: line.has_schedule,
    active: line.active,
  };
}

export async function getLineStops(lineId: string) {
  await lineIndex.buildLineIndex();
  const line = lineIndex.getLine(lineId);
  if (!line) return null;

  const allStops: number[] = [];
  for (const [, dData] of Object.entries(line.directions)) {
    for (const sid of dData.stops) {
      if (!allStops.includes(sid)) allStops.push(sid);
    }
  }

  return { line: line.id, color: line.color, stops: allStops, total: allStops.length };
}

export async function getLineRoute(lineId: string, dirFilter: string) {
  await lineIndex.buildLineIndex();
  const line = lineIndex.getLine(lineId);
  if (!line) return null;

  const directions: any[] = [];
  for (const [dId, dData] of Object.entries(line.directions)) {
    if (dirFilter !== 'all' && dId !== dirFilter) continue;
    
    const stops = await Promise.all(dData.stops.map(async (sid) => {
      const odStop = await openData.getStopById(sid);
      if (odStop) return odStop;
      const fallback = await resolveStop(sid);
      if (fallback) return { ...fallback, lines: lineIndex.getLinesForStop(sid) };
      return { stopId: sid, name: `Parada ${sid}`, lat: null, lng: null, address: null, sentido: null, lines: [], source: 'stops_min' };
    }));
    directions.push({ id: dId, destination: dData.destination, stops });
  }

  return { line: line.id, color: line.color, directions };
}

export async function getLinesIntersect(a: string, b: string) {
  await lineIndex.buildLineIndex();

  const lineA = lineIndex.getLine(a);
  const lineB = lineIndex.getLine(b);
  if (!lineA || !lineB) {
    return { error: 'not_found', missingA: !lineA, missingB: !lineB };
  }

  const stopsA = new Set(lineIndex.getLineStops(a, '1').concat(lineIndex.getLineStops(a, '2')));
  const stopsB = lineIndex.getLineStops(b, '1').concat(lineIndex.getLineStops(b, '2'));
  const common = stopsB.filter(s => stopsA.has(s));

  return { line_a: a, line_b: b, common_stops: common, total: common.length };
}
