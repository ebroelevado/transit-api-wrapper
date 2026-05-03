import { LineInfo } from '../types';
import { stopCoordsCache } from '../sources/lineIndex';
import { BUS_SPEED_KMH, TRANSFER_PENALTY_MIN } from '../config';
import { getNextDepartureFromOrigin } from './schedules.service';
import { MinHeap } from '../utils/MinHeap';

export interface Edge {
  to: number;
  line: string | 'walk';
  line_name: string;
  color: string;
  dir: string;
  weight: number;      // travel time in minutes
  distance: number;    // meters
}

export interface GraphNode {
  stopId: number;
  edges: Edge[];
}

const graph: Map<number, GraphNode> = new Map();
const timeFromOriginCache: Map<string, number> = new Map();

// Helper: Haversine distance in meters
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // meters
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * rad) * Math.cos(lat2 * rad) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function buildGraph(catalog: Map<string, LineInfo>): void {
  graph.clear();
  timeFromOriginCache.clear();
  let edgesAdded = 0;

  for (const [lineId, line] of catalog) {
    for (const [dir, direction] of Object.entries(line.directions)) {
      const stops = direction.stops;
      let accumulatedTime = 0;
      
      for (let i = 0; i < stops.length; i++) {
        const stopId = stops[i];
        if (!graph.has(stopId)) graph.set(stopId, { stopId, edges: [] });
        
        // Save accumulated time from origin for this line-dir-stop
        timeFromOriginCache.set(`${lineId}-${dir}-${stopId}`, accumulatedTime);

        if (i < stops.length - 1) {
          const nextStop = stops[i + 1];
          if (!graph.has(nextStop)) graph.set(nextStop, { stopId: nextStop, edges: [] });

          const fromCoords = stopCoordsCache.get(stopId);
          const toCoords = stopCoordsCache.get(nextStop);
          const distance = (fromCoords && toCoords)
            ? haversineDistance(fromCoords.lat, fromCoords.lng, toCoords.lat, toCoords.lng)
            : 300;

          let weight = (distance / 1000) / BUS_SPEED_KMH * 60;
          if (weight < 0.5) weight = 0.5;

          graph.get(stopId)!.edges.push({
            to: nextStop,
            line: lineId,
            line_name: line.name,
            color: line.color,
            dir,
            weight,
            distance,
          });
          edgesAdded++;
          accumulatedTime += weight;
        }
      }
    }
  }

  // Generate walking edges between nearby stops (max 300m)
  const stopIds = Array.from(graph.keys());
  let walkingEdges = 0;
  for (let i = 0; i < stopIds.length; i++) {
    for (let j = i + 1; j < stopIds.length; j++) {
      const s1 = stopIds[i];
      const s2 = stopIds[j];
      const c1 = stopCoordsCache.get(s1);
      const c2 = stopCoordsCache.get(s2);
      if (c1 && c2) {
        const dist = haversineDistance(c1.lat, c1.lng, c2.lat, c2.lng);
        if (dist <= 300) {
          // Walk time: 5 km/h = ~83.3 meters/min
          const walkTime = dist / (5000 / 60); 
          graph.get(s1)!.edges.push({ to: s2, line: 'walk', line_name: 'Caminar', color: '#999', dir: '', weight: walkTime, distance: dist });
          graph.get(s2)!.edges.push({ to: s1, line: 'walk', line_name: 'Caminar', color: '#999', dir: '', weight: walkTime, distance: dist });
          walkingEdges += 2;
        }
      }
    }
  }

  console.log(`[transitGraph] Built graph with ${graph.size} nodes, ${edgesAdded} line edges, and ${walkingEdges} walk edges.`);
}

export interface TripLeg {
  line: string;
  line_name: string;
  color: string;
  direction: string;
  from_stop: { stopId: number; name: string; lat: number; lng: number };
  to_stop: { stopId: number; name: string; lat: number; lng: number };
  intermediate_stops: number;
  estimated_min: number;
  distance_m: number;
  geometry: [number, number][]; // [lon, lat] for GeoJSON
}

export interface OptimalTripOption {
  type: 'direct' | 'transfer';
  estimated_total_min: number;
  walk_distance_m: number;
  legs: TripLeg[];
}

interface DijkstraState {
  stopId: number;
  totalWeight: number; // accumulated time
  currentLine: string | null;
  transfers: number;
  path: {
    edge: Edge | null;
    fromStop: number;
    waitTime: number; // dynamically calculated wait time
  }[];
}

export function findOptimalRoute(
  fromStop: number,
  toStop: number,
  fromCoords?: { lat: number; lng: number },
  toCoords?: { lat: number; lng: number },
  departureTimeMinutes?: number,
  dayType: string = 'weekday'
): OptimalTripOption | null {
  if (!graph.has(fromStop) || !graph.has(toStop)) return null;

  const maxTransfers = 2;
  
  const queue = new MinHeap<DijkstraState>();
  queue.push(0, {
    stopId: fromStop,
    totalWeight: 0,
    currentLine: null,
    transfers: 0,
    path: []
  });

  const minWeight = new Map<string, number>();
  let bestFinalState: DijkstraState | null = null;

  while (queue.length > 0) {
    const current = queue.pop()!;

    if (current.stopId === toStop) {
      if (!bestFinalState || current.totalWeight < bestFinalState.totalWeight) {
        bestFinalState = current;
      }
      continue;
    }

    const node = graph.get(current.stopId)!;

    for (const edge of node.edges) {
      const isWalk = edge.line === 'walk';
      const isTransfer = current.currentLine !== null && current.currentLine !== edge.line && !isWalk;
      const isFirstBoarding = current.currentLine === null && !isWalk;
      
      const newTransfers = current.transfers + (isTransfer ? 1 : 0);
      if (newTransfers > maxTransfers) continue;

      let waitTime = 0;
      let newWeight = current.totalWeight + edge.weight;

      // Dynamic schedule penalty logic
      if ((isTransfer || isFirstBoarding) && departureTimeMinutes !== undefined) {
        // Calculate wait time
        const absoluteCurrentTime = departureTimeMinutes + current.totalWeight + (isTransfer ? TRANSFER_PENALTY_MIN : 0);
        const tFromOrigin = timeFromOriginCache.get(`${edge.line}-${edge.dir}-${current.stopId}`) || 0;
        
        const neededDeparture = absoluteCurrentTime - tFromOrigin;
        
        const nextDep = getNextDepartureFromOrigin(edge.line, edge.dir, dayType, neededDeparture);
        if (nextDep !== null) {
          const busArrivesAtStop = nextDep + tFromOrigin;
          waitTime = Math.max(0, busArrivesAtStop - absoluteCurrentTime);
        } else {
          // No more buses today
          continue; 
        }
        
        newWeight += waitTime;
        if (isTransfer) newWeight += TRANSFER_PENALTY_MIN;
      } else if (isTransfer) {
        // Fallback static penalty
        newWeight += TRANSFER_PENALTY_MIN;
      }

      const stateKey = `${edge.to}-${edge.line}`;
      const bestKnownWeight = minWeight.get(stateKey) || Infinity;

      if (newWeight < bestKnownWeight) {
        minWeight.set(stateKey, newWeight);
        queue.push(newWeight, {
          stopId: edge.to,
          totalWeight: newWeight,
          currentLine: edge.line,
          transfers: newTransfers,
          path: [...current.path, { edge, fromStop: current.stopId, waitTime }]
        });
      }
    }
  }

  if (!bestFinalState) return null;

  // Reconstruct path
  const legs: TripLeg[] = [];
  let currentLeg: TripLeg | null = null;

  const getStopData = (id: number) => {
    const coords = stopCoordsCache.get(id);
    return { stopId: id, name: '', lat: coords?.lat || 0, lng: coords?.lng || 0 };
  };

  for (const step of bestFinalState.path) {
    if (!step.edge) continue;

    if (!currentLeg || currentLeg.line !== step.edge.line) {
      if (currentLeg) legs.push(currentLeg);
      const fromD = getStopData(step.fromStop);
      currentLeg = {
        line: step.edge.line,
        line_name: step.edge.line_name,
        color: step.edge.color,
        direction: step.edge.dir,
        from_stop: fromD,
        to_stop: getStopData(step.edge.to),
        intermediate_stops: 0,
        estimated_min: step.edge.weight + step.waitTime,
        distance_m: step.edge.distance,
        geometry: [[fromD.lng, fromD.lat]],
      };
    } else {
      currentLeg.intermediate_stops++;
      currentLeg.estimated_min += step.edge.weight;
      currentLeg.distance_m += step.edge.distance;
    }
    
    currentLeg.to_stop = getStopData(step.edge.to);
    currentLeg.geometry.push([currentLeg.to_stop.lng, currentLeg.to_stop.lat]);
  }

  if (currentLeg) legs.push(currentLeg);

  let walk_distance_m = 0;
  for (const leg of legs) {
    if (leg.line === 'walk') {
      walk_distance_m += leg.distance_m;
    }
  }

  let origin_dest_walk_time = 0;
  if (fromCoords && legs.length > 0) {
    const firstLeg = legs[0];
    const d = haversineDistance(fromCoords.lat, fromCoords.lng, firstLeg.from_stop.lat, firstLeg.from_stop.lng);
    walk_distance_m += d;
    origin_dest_walk_time += d / 83;
  }
  if (toCoords && legs.length > 0) {
    const lastLeg = legs[legs.length - 1];
    const d = haversineDistance(lastLeg.to_stop.lat, lastLeg.to_stop.lng, toCoords.lat, toCoords.lng);
    walk_distance_m += d;
    origin_dest_walk_time += d / 83;
  }

  const busLegsCount = legs.filter(l => l.line !== 'walk').length;

  return {
    type: busLegsCount > 1 ? 'transfer' : 'direct',
    estimated_total_min: Math.ceil(bestFinalState.totalWeight + origin_dest_walk_time),
    walk_distance_m: Math.round(walk_distance_m),
    legs
  };
}
