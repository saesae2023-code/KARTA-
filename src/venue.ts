/**
 * Schematic topology of the Canton Fair Complex (Pazhou), hall level only.
 *
 * Confirmed by public sources (CIEFC, Baidu wiki, fair guides):
 *  - Area A = halls 1–8, Area B = halls 9–13, both north of Xingang Dong Rd,
 *    joined east–west by the Pearl River Promenade / corridors;
 *  - Area C = halls 14–16, south of Xingang Dong Rd;
 *  - Area D (Phase IV) = halls 17–20, west of Area A, joined by a connecting corridor.
 *
 * NOT confirmed (assumption, adjust here if the official plan differs):
 *  - halls inside an area are placed in numeric order along one row;
 *  - in Area D hall 17 is the one next to Area A;
 *  - Area C sits south of Area B.
 * No booth coordinates exist: points are bound to halls only.
 */

export interface AreaDef {
  id: 'A' | 'B' | 'C' | 'D';
  label: string;
  buildings: number[];
}

export const AREAS: AreaDef[] = [
  { id: 'D', label: 'Area D', buildings: [20, 19, 18, 17] },
  { id: 'A', label: 'Area A', buildings: [1, 2, 3, 4, 5, 6, 7, 8] },
  { id: 'B', label: 'Area B', buildings: [9, 10, 11, 12, 13] },
  { id: 'C', label: 'Area C', buildings: [14, 15, 16] },
];

/** Building centre in schematic units (1 unit ≈ one hall width). Row 0 = north, row 1 = south of the road. */
export const BUILDING_POS: Record<number, { x: number; row: 0 | 1 }> = {};
{
  let x = 0;
  for (const a of AREAS.filter((a) => a.id !== 'C')) {
    for (const b of a.buildings) BUILDING_POS[b] = { x: x++, row: 0 };
    x += 0.4; // corridor between areas
  }
  const bStart = BUILDING_POS[9].x;
  const c = AREAS.find((a) => a.id === 'C')!;
  c.buildings.forEach((b, i) => (BUILDING_POS[b] = { x: bStart + 0.5 + i * 1.4, row: 1 }));
}

export function areaOf(building: number): AreaDef | undefined {
  return AREAS.find((a) => a.buildings.includes(building));
}

export function splitHall(h: string): { building: number; floor: number } {
  const [b, f] = h.split('.');
  return { building: Number(b) || 0, floor: Number(f) || 0 };
}

const FLOOR_COST = 0.35; // escalator inside one building
const ROAD_COST = 1.5; // crossing Xingang Dong Rd between north row and Area C
const BUILDING_CHANGE = 1.5; // leaving a building costs extra, so its floors are finished together
const UNKNOWN_COST = 50;

/** Walking-cost proxy between two halls (e.g. "15.2" → "9.1"). */
export function hallCost(a: string | null, b: string): number {
  if (!a) return 0;
  if (a === b) return 0;
  const pa = splitHall(a);
  const pb = splitHall(b);
  const A = BUILDING_POS[pa.building];
  const B = BUILDING_POS[pb.building];
  if (!A || !B) return UNKNOWN_COST + Math.abs(pa.building - pb.building);
  const dy = A.row !== B.row ? ROAD_COST + 1 : 0;
  const change = pa.building !== pb.building ? BUILDING_CHANGE : 0;
  return Math.abs(A.x - B.x) + dy + change + Math.abs(pa.floor - pb.floor) * FLOOR_COST;
}
