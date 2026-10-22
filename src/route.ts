import { HAS_APLUS, POINTS, isAPlus } from './data';
import { DATASET } from './phase';
import { priorityRank } from './logic';
import type { Point, PointState } from './types';
import { NODE_BY_ID, costFromPoint, hallCost, nodeOfHall, splitHall, type Pt } from './venue';

export type RouteMode = 'nearest' | 'aFirst' | 'onlyA' | 'onlyAPlus';

export const ROUTE_MODES: { id: RouteMode; label: string }[] = [
  { id: 'nearest', label: 'Ближайшие' },
  { id: 'aFirst', label: 'Сначала A' },
  { id: 'onlyA', label: 'Только A' },
  // Only for phases whose Excel marks must-visit points.
  ...(HAS_APLUS ? [{ id: 'onlyAPlus' as const, label: 'Только A+' }] : []),
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
  segment: Stop['segment'];
}

/** Route start: a hall ("15.2"), a projected GPS position on the venue plan, or nothing. */
export type Start = string | Pt | null;

export const isPt = (s: Start): s is Pt => typeof s === 'object' && s !== null;

/** Walking cost from a start (hall or GPS point) to a hall. */
export function startCost(from: Start, to: string): number {
  return isPt(from) ? costFromPoint(from, to) : hallCost(from, to);
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

function pathCost(start: Start, halls: string[]): number {
  let c = 0;
  let at: Start = start;
  for (const h of halls) {
    c += startCost(at, h);
    at = h;
  }
  return c;
}

/** Nearest-neighbour tour from `start`, improved with 2-opt (open path, fixed start). */
function tour(halls: string[], start: Start): string[] {
  const rest = halls.slice();
  const path: string[] = [];
  let at: Start = start;
  if (typeof at === 'string' && rest.includes(at)) {
    path.push(at);
    rest.splice(rest.indexOf(at), 1);
  }
  while (rest.length) {
    const from = at;
    rest.sort((a, b) => startCost(from, a) - startCost(from, b) || a.localeCompare(b, undefined, { numeric: true }));
    at = rest.shift()!;
    path.push(at);
  }
  const fixed = typeof start === 'string' && path[0] === start ? 1 : 0;
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

function bestTour(halls: string[], start: Start): string[] {
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

function groupBy<T>(xs: T[], f: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) m.set(f(x), [...(m.get(f(x)) ?? []), x]);
  return m;
}

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest]));
}

const areaKey = (hall: string) => NODE_BY_ID.get(nodeOfHall(hall))?.area ?? '?';

/**
 * One area: buildings in a walking tour, then the floors of each building consecutively
 * (one direction, starting from the end nearest to the arrival floor).
 */
function orderArea(halls: string[], at: Start): string[] {
  const byBuilding = groupBy(halls, nodeOfHall);
  const reps = Array.from(byBuilding.entries()).map(([, hs]) =>
    typeof at === 'string' && hs.includes(at) ? at : hs.slice().sort((x, y) => splitHall(x).floor - splitHall(y).floor)[0],
  );
  const buildingTour = bestTour(reps, at);
  const out: string[] = [];
  let floor = typeof at === 'string' ? splitHall(at).floor : 1;
  for (const rep of buildingTour) {
    const levels = byBuilding.get(nodeOfHall(rep))!.slice().sort((x, y) => splitHall(x).floor - splitHall(y).floor);
    const lo = splitHall(levels[0]).floor;
    const hi = splitHall(levels[levels.length - 1]).floor;
    if (Math.abs(floor - hi) < Math.abs(floor - lo)) levels.reverse();
    out.push(...levels);
    floor = splitHall(out[out.length - 1]).floor;
  }
  return out;
}

/**
 * Level 1 (hall route), hierarchical: each Area is entered once and finished before moving on,
 * each building is entered once and its floors are done together. The Area order is chosen by trying
 * every permutation (≤ 4 areas) and keeping the one with the smallest total walking cost.
 */
function orderHalls(halls: string[], start: Start): string[] {
  const byArea = groupBy(halls, areaKey);
  let best: string[] = [];
  let bestCost = Infinity;
  for (const perm of areaOrders(Array.from(byArea.keys()), start)) {
    let at: Start = start;
    const seq: string[] = [];
    for (const area of perm) {
      const part = orderArea(byArea.get(area)!, at);
      seq.push(...part);
      at = part[part.length - 1];
    }
    const c = pathCost(start, seq);
    if (c < bestCost) {
      best = seq;
      bestCost = c;
    }
  }
  return best;
}

/**
 * Area orders to try. With no start (no GPS, no current hall) and a default order in the Excel
 * (Phase 2 ROUTE STRATEGY: «Зона B → Зона C → Зона D → Зона A») that order is used as is.
 */
function areaOrders(areas: string[], start: Start): string[][] {
  const fixed = DATASET.defaultAreaOrder;
  if (start || !fixed?.length) return permutations(areas);
  const rank = (a: string) => (fixed.includes(a) ? fixed.indexOf(a) : fixed.length);
  return [areas.slice().sort((a, b) => rank(a) - rank(b))];
}

function planSegment(points: Point[], start: Start, segment: Stop['segment']): Stop[] {
  if (!points.length) return [];
  const halls = Array.from(new Set(points.flatMap((p) => p.halls)));
  const first = orderHalls(halls, start);
  // A point with stands in several halls is visited in the hall reached first.
  const byHall = new Map<string, Point[]>();
  for (const p of points) {
    const h = first.find((x) => p.halls.includes(x)) ?? p.halls[0];
    byHall.set(h, [...(byHall.get(h) ?? []), p]);
  }
  const order = orderHalls(Array.from(byHall.keys()), start);
  return order.map((hall) => ({ hall, points: sortInHall(byHall.get(hall)!, hall), segment }));
}

/**
 * Route over all pending points from the start (GPS position or hall):
 *  1. Area order minimising total walking; every Area visited once;
 *  2. inside an Area a building tour (nearest-neighbour + 2-opt); floors of a building together;
 *  3. Level 2: inside a hall follow booth / aisle order (logical, not GPS).
 */
export function planRoute(states: Record<number, PointState>, current: Start, mode: RouteMode): Plan {
  const pending = POINTS.filter((p) => states[p.id].visit === 'pending');
  let stops: Stop[];
  if (mode === 'onlyAPlus') {
    stops = planSegment(pending.filter(isAPlus), current, 'all');
  } else if (mode === 'onlyA') {
    stops = planSegment(pending.filter((p) => p.priority === 'A'), current, 'all');
  } else if (mode === 'aFirst') {
    const a = planSegment(pending.filter((p) => p.priority === 'A'), current, 'A');
    const last: Start = a.length ? a[a.length - 1].hall : current;
    stops = [...a, ...planSegment(pending.filter((p) => p.priority !== 'A'), last, 'B')];
  } else {
    stops = planSegment(pending, current, 'all');
  }
  const steps = stops.flatMap((s) => s.points.map((point) => ({ point, hall: s.hall, booths: boothsOf(point, s.hall), segment: s.segment })));
  return { stops, steps };
}

// ---- locked route ---------------------------------------------------------

export interface RouteLock {
  items: { id: number; hall: string; segment: Stop['segment'] }[];
  mode: RouteMode;
  start: 'gps' | 'hall' | 'none';
  at: string;
}

export function lockFromPlan(plan: Plan, mode: RouteMode, start: Start): RouteLock {
  return {
    items: plan.steps.map((s) => ({ id: s.point.id, hall: s.hall, segment: s.segment })),
    mode,
    start: isPt(start) ? 'gps' : start ? 'hall' : 'none',
    at: new Date().toISOString(),
  };
}

/** The locked order minus finished points. Consecutive points of one hall form a stop. */
export function planFromLock(lock: RouteLock, states: Record<number, PointState>): Plan {
  const byId = new Map(POINTS.map((p) => [p.id, p]));
  const steps: Step[] = [];
  for (const it of lock.items) {
    const point = byId.get(it.id);
    if (!point || states[it.id]?.visit !== 'pending') continue;
    steps.push({ point, hall: it.hall, booths: boothsOf(point, it.hall), segment: it.segment });
  }
  const stops: Stop[] = [];
  for (const st of steps) {
    const last = stops[stops.length - 1];
    if (last && last.hall === st.hall && last.segment === st.segment) last.points.push(st.point);
    else stops.push({ hall: st.hall, points: [st.point], segment: st.segment });
  }
  return { stops, steps };
}

/** True when the lock no longer covers the pending set (new pending points, other mode). */
export function lockIsStale(lock: RouteLock | null, states: Record<number, PointState>, mode: RouteMode): boolean {
  if (!lock || lock.mode !== mode) return true;
  const ids = new Set(lock.items.map((i) => i.id));
  return POINTS.some((p) => states[p.id].visit === 'pending' && !ids.has(p.id) && (mode === 'onlyA' ? p.priority === 'A' : mode === 'onlyAPlus' ? isAPlus(p) : true));
}

/** Total walking cost of a plan from a start. */
export function planCost(plan: Plan, start: Start): number {
  return pathCost(start, plan.stops.map((s) => s.hall));
}

export function transitions(stops: Stop[], current: string | null): number {
  let n = 0;
  let at: string | null = current;
  for (const s of stops) {
    if (at !== null && s.hall !== at) n++;
    at = s.hall;
  }
  return n;
}
