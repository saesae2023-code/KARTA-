/**
 * Canton Fair Complex (Pazhou) — hall-level venue graph.
 *
 * Every geometric element carries its basis:
 *   'official' — official Canton Fair / CIEFC material or the layout given by the user from the official Hall Map;
 *   'approx'   — not confirmed; kept only because routing needs *some* value. Listed in VENUE_NOTES.
 *
 * Official:
 *   - Area D = halls 17–20, western (left) part; joined to Area A by the Connecting Corridor (Phase IV).
 *   - Area A = halls 1–8, central / northern part.
 *   - Area B = halls 9–13, eastern (right) part.
 *   - Area C = halls 14–16, southern part, south of Xingang Dong Rd.
 *   - Pearl River Promenade runs east–west through Areas A and B.
 *   - Hall 20.1 lies at the north-east of Area D (CIEFC exhibitor notice: "D区一层北面卡车通道东侧（即20.1展厅外东北面）"),
 *     i.e. hall 20 is the D hall on the Area A side.
 *   - Floors x.1 … x.4 of one number are levels of ONE physical building.
 * Approximations (no official plan accessible from the build environment):
 *   - order of halls inside an area (taken in numeric order west → east, D: 17 → 20);
 *   - exact spot where the corridor / promenade meet each area (assumed at the facing end halls);
 *   - exact position of Area C relative to A/B and of the Xingang Dong Rd crossing (one crossing node at the A/B junction);
 *   - Middle Platform: position not confirmed, not drawn and not used for routing.
 * No booth coordinates exist: points are bound to halls only.
 */

export type Basis = 'official' | 'approx';

export interface AreaDef {
  id: 'A' | 'B' | 'C' | 'D';
  label: string;
  /** Buildings west → east. */
  buildings: number[];
  row: 0 | 1;
}

export const AREAS: AreaDef[] = [
  { id: 'D', label: 'Area D', buildings: [17, 18, 19, 20], row: 0 },
  { id: 'A', label: 'Area A', buildings: [1, 2, 3, 4, 5, 6, 7, 8], row: 0 },
  { id: 'B', label: 'Area B', buildings: [9, 10, 11, 12, 13], row: 0 },
  { id: 'C', label: 'Area C', buildings: [14, 15, 16], row: 1 },
];

/** Schematic building centre (1 unit ≈ one hall width). Row 0 = north of Xingang Dong Rd, row 1 = south. */
export const BUILDING_POS: Record<number, { x: number; row: 0 | 1 }> = {};
{
  let x = 0;
  for (const id of ['D', 'A', 'B'] as const) {
    for (const b of AREAS.find((a) => a.id === id)!.buildings) BUILDING_POS[b] = { x: x++, row: 0 };
    x += 0.6; // corridor / promenade gap between areas
  }
}

/** Point where Area A meets Area B on the Pearl River Promenade. */
export const AB_JUNCTION_X = (BUILDING_POS[8].x + BUILDING_POS[9].x) / 2;
{
  const c = AREAS.find((a) => a.id === 'C')!;
  const mid = (c.buildings.length - 1) / 2;
  c.buildings.forEach((b, i) => (BUILDING_POS[b] = { x: AB_JUNCTION_X + (i - mid) * 1.4, row: 1 }));
}

export type EdgeKind = 'walk' | 'corridor' | 'promenade' | 'road';

export interface Edge {
  a: number | 'X';
  b: number | 'X';
  kind: EdgeKind;
  cost: number;
  basis: Basis;
  label?: string;
}

/** 'X' = Xingang Dong Rd crossing node (approximate position, see notes). */
const edges: Edge[] = [];
for (const area of AREAS) {
  area.buildings.slice(1).forEach((b, i) => edges.push({ a: area.buildings[i], b, kind: 'walk', cost: 1, basis: 'approx' }));
}
edges.push({ a: 20, b: 1, kind: 'corridor', cost: 1.2, basis: 'official', label: 'Connecting Corridor D ↔ A' });
edges.push({ a: 8, b: 9, kind: 'promenade', cost: 1, basis: 'official', label: 'Pearl River Promenade A ↔ B' });
edges.push({ a: 8, b: 'X', kind: 'promenade', cost: 0.5, basis: 'approx' });
edges.push({ a: 9, b: 'X', kind: 'promenade', cost: 0.5, basis: 'approx' });
edges.push({ a: 'X', b: 15, kind: 'road', cost: 2.5, basis: 'approx', label: 'Переход через Xingang Dong Rd' });

export const VENUE_EDGES: readonly Edge[] = edges;

export const VENUE_NOTES: { basis: Basis; text: string }[] = [
  { basis: 'official', text: 'Area D (Hall 17–20) — запад; Area A (1–8) — центр/север; Area B (9–13) — восток; Area C (14–16) — юг за Xingang Dong Rd.' },
  { basis: 'official', text: 'Connecting Corridor соединяет D и A; Pearl River Promenade идёт с запада на восток через A и B.' },
  { basis: 'official', text: 'Hall 20 — корпус D со стороны Area A (20.1 — северо-восток Area D).' },
  { basis: 'official', text: 'Этажи x.1–x.4 — уровни одного корпуса: переход между ними вертикальный.' },
  { basis: 'approx', text: 'Порядок корпусов внутри зон — по номерам с запада на восток.' },
  { basis: 'approx', text: 'Положение Area C и точка перехода через Xingang Dong Rd — условно у стыка A/B.' },
  { basis: 'approx', text: 'Middle Platform не нанесена: её положение не подтверждено.' },
];

export function areaOf(building: number): AreaDef | undefined {
  return AREAS.find((a) => a.buildings.includes(building));
}

export function splitHall(h: string): { building: number; floor: number } {
  const [b, f] = h.split('.');
  return { building: Number(b) || 0, floor: Number(f) || 0 };
}

/** All-pairs shortest walking cost between buildings (Floyd–Warshall over VENUE_EDGES). */
const BUILDING_COST: Map<string, number> = (() => {
  const nodes: (number | 'X')[] = ['X', ...AREAS.flatMap((a) => a.buildings)];
  const key = (a: number | 'X', b: number | 'X') => `${a}|${b}`;
  const d = new Map<string, number>();
  for (const a of nodes) for (const b of nodes) d.set(key(a, b), a === b ? 0 : Infinity);
  for (const e of VENUE_EDGES) {
    d.set(key(e.a, e.b), Math.min(d.get(key(e.a, e.b))!, e.cost));
    d.set(key(e.b, e.a), Math.min(d.get(key(e.b, e.a))!, e.cost));
  }
  for (const k of nodes)
    for (const i of nodes)
      for (const j of nodes) {
        const via = d.get(key(i, k))! + d.get(key(k, j))!;
        if (via < d.get(key(i, j))!) d.set(key(i, j), via);
      }
  return d;
})();

const VERTICAL_COST = 0.35; // escalator per level inside one building
const BUILDING_CHANGE = 1.5; // leaving a building costs extra, so its floors are finished together
const UNKNOWN_COST = 50;

/** Pedestrian cost between two halls (e.g. "15.2" → "9.1") over the venue graph. */
export function hallCost(a: string | null, b: string): number {
  if (!a) return 0;
  if (a === b) return 0;
  const pa = splitHall(a);
  const pb = splitHall(b);
  const vertical = Math.abs(pa.floor - pb.floor) * VERTICAL_COST;
  if (pa.building === pb.building) return vertical;
  const walk = BUILDING_COST.get(`${pa.building}|${pb.building}`);
  if (walk === undefined || !Number.isFinite(walk)) return UNKNOWN_COST + Math.abs(pa.building - pb.building);
  return walk + BUILDING_CHANGE + vertical;
}
