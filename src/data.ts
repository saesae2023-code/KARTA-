import { hallCost } from './venue';
import { DATASET as dataset } from './phase';
import type { Point } from './types';

export const POINTS: Point[] = (dataset.points as Point[]).slice().sort((a, b) => a.id - b.id);
export const COLUMNS: string[] = dataset.columns;

export const ALL_HALLS: string[] = Array.from(new Set(POINTS.flatMap((p) => p.halls))).sort(compareHalls);
export const ALL_CATEGORIES: string[] = Array.from(new Set(POINTS.map((p) => p.category))).sort((a, b) =>
  a.localeCompare(b, 'ru'),
);
export const ALL_GROUPS: string[] = Array.from(new Set(POINTS.map((p) => p.mapGroup))).sort();
export const ALL_PRIORITIES: string[] = Array.from(new Set(POINTS.map((p) => p.priority))).sort();
/** The dataset has must-visit points («A+», Excel PRIORITY ROUTE). */
export const HAS_APLUS = POINTS.some((p) => p.strategic === 'A+');
export const isAPlus = (p: Point) => p.strategic === 'A+';

/** Records sharing exactly the same booth string (e.g. two entries for one stand). */
export const SAME_BOOTH: Map<number, number[]> = (() => {
  const byBooth = new Map<string, number[]>();
  for (const p of POINTS) {
    const key = p.booth.replace(/\s+/g, '').toUpperCase();
    byBooth.set(key, [...(byBooth.get(key) ?? []), p.id]);
  }
  const m = new Map<number, number[]>();
  for (const ids of byBooth.values()) {
    if (ids.length > 1) for (const id of ids) m.set(id, ids.filter((x) => x !== id));
  }
  return m;
})();

export function parseHall(h: string): { building: number; floor: number } {
  const [b, f] = h.split('.');
  return { building: Number(b) || 0, floor: Number(f) || 0 };
}

export function compareHalls(a: string, b: string): number {
  const pa = parseHall(a);
  const pb = parseHall(b);
  return pa.building - pb.building || pa.floor - pb.floor;
}

/** Walking-cost proxy between halls, based on the schematic complex topology (see venue.ts). */
export function hallDistance(a: string | null, b: string): number {
  return hallCost(a, b);
}
