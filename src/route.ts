import { POINTS } from './data';
import { priorityRank } from './logic';
import type { Point, PointState } from './types';
import { hallCost } from './venue';

export type RouteMode = 'nearest' | 'aFirst' | 'onlyA';

export const ROUTE_MODES: { id: RouteMode; label: string }[] = [
  { id: 'nearest', label: 'Ближайшие' },
  { id: 'aFirst', label: 'Сначала A' },
  { id: 'onlyA', label: 'Только A' },
];

export interface Stop {
  hall: string;
  points: Point[];
  /** Priority segment for the "Сначала A" mode. */
  segment: 'all' | 'A' | 'B';
}

export interface Step {
  point: Point;
  hall: string;
  booths: string[];
}

export interface Plan {
  stops: Stop[];
  steps: Step[];
}

const BOOTH_RE = /(\d{1,2}\.\d)\s*([A-Z]{1,2})(\d+)/;

function boothsOf(p: Point, hall: string): string[] {
  const own = p.booths.filter((b) => b.hall === hall).map((b) => b.label);
  return own.length ? own : p.booths.map((b) => b.label);
}

/** Booth position key inside a hall: zone letter, then stand number. */
function boothKey(p: Point, hall: string): [string, number] {
  const m = boothsOf(p, hall)[0]?.match(BOOTH_RE);
  return m ? [m[2], Number(m[3])] : ['ZZ', 0];
}

/** Points inside one hall in a walkable sequence: zone by zone, stand numbers ascending. */
export function sortInHall(points: Point[], hall: string): Point[] {
  return points.slice().sort((a, b) => {
    const [la, na] = boothKey(a, hall);
    const [lb, nb] = boothKey(b, hall);
    return la.localeCompare(lb) || na - nb || priorityRank(a) - priorityRank(b) || a.id - b.id;
  });
}

function pathCost(start: string | null, halls: string[]): number {
  let c = 0;
  let at = start;
  for (const h of halls) {
    c += hallCost(at, h);
    at = h;
  }
  return c;
}

/** Nearest-neighbour tour from `start`, improved with 2-opt (open path, fixed start). */
function tour(halls: string[], start: string | null): string[] {
  const rest = halls.slice();
  const path: string[] = [];
  let at = start;
  if (at && rest.includes(at)) {
    path.push(at);
    rest.splice(rest.indexOf(at), 1);
  }
  while (rest.length) {
    const from = at;
    rest.sort((a, b) => hallCost(from, a) - hallCost(from, b) || a.localeCompare(b, undefined, { numeric: true }));
    at = rest.shift()!;
    path.push(at);
  }
  const fixed = start && path[0] === start ? 1 : 0;
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = fixed; i < path.length - 1; i++) {
      for (let j = i + 1; j < path.length; j++) {
        const cand = [...path.slice(0, i), ...path.slice(i, j + 1).reverse(), ...path.slice(j + 1)];
        if (pathCost(start, cand) + 1e-9 < pathCost(start, path)) {
          path.splice(0, path.length, ...cand);
          improved = true;
        }
      }
    }
  }
  return path;
}

function bestTour(halls: string[], start: string | null): string[] {
  if (start || halls.length < 2) return tour(halls, start);
  // No current hall: try every hall as the starting point, keep the cheapest walk.
  let best: string[] = [];
  let bestCost = Infinity;
  for (const h of halls) {
    const t = tour(halls, h);
    const c = pathCost(null, t);
    if (c < bestCost) {
      best = t;
      bestCost = c;
    }
  }
  return best;
}

function planSegment(points: Point[], start: string | null, segment: Stop['segment']): Stop[] {
  if (!points.length) return [];
  const halls = Array.from(new Set(points.flatMap((p) => p.halls)));
  const first = bestTour(halls, start);
  // A point with stands in several halls is visited in the hall reached first.
  const byHall = new Map<string, Point[]>();
  for (const p of points) {
    const h = first.find((x) => p.halls.includes(x)) ?? p.halls[0];
    byHall.set(h, [...(byHall.get(h) ?? []), p]);
  }
  const order = bestTour(Array.from(byHall.keys()), start);
  return order.map((hall) => ({ hall, points: sortInHall(byHall.get(hall)!, hall), segment }));
}

/**
 * Hall-level route over all pending points:
 *  1. finish the current hall first;
 *  2. then go to the physically nearest hall (venue topology), minimising total walking;
 *  3. inside a hall follow booth order.
 */
export function planRoute(states: Record<number, PointState>, current: string | null, mode: RouteMode): Plan {
  const pending = POINTS.filter((p) => states[p.id].visit === 'pending');
  let stops: Stop[];
  if (mode === 'onlyA') {
    stops = planSegment(pending.filter((p) => p.priority === 'A'), current, 'all');
  } else if (mode === 'aFirst') {
    const a = planSegment(pending.filter((p) => p.priority === 'A'), current, 'A');
    const last = a.length ? a[a.length - 1].hall : current;
    stops = [...a, ...planSegment(pending.filter((p) => p.priority !== 'A'), last, 'B')];
  } else {
    stops = planSegment(pending, current, 'all');
  }
  const steps = stops.flatMap((s) => s.points.map((point) => ({ point, hall: s.hall, booths: boothsOf(point, s.hall) })));
  return { stops, steps };
}

export function transitions(stops: Stop[], current: string | null): number {
  let n = 0;
  let at = current;
  for (const s of stops) {
    if (at !== null && s.hall !== at) n++;
    at = s.hall;
  }
  return n;
}
