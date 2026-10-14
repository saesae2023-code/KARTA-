/**
 * Canton Fair Complex (Pazhou) — hall-level venue graph.
 *
 * Geometry source: official "Exhibition Section Floor Map of the 140th China Import and Export Fair (Phase 1)"
 * (365.cantonfair.org.cn) and the official Complex Layout. Hall positions are the ground-floor (x.1) blocks of the
 * isometric floor map, de-skewed along the Zhanchang Xilu/Zhonglu/Donglu axes, in units of ≈ one hall width.
 *
 *  - Area D: halls 17–20 west → east along Xingang Donglu, Friendship Hall (21.2) east of 20.
 *  - Area A: halls 1–5 west → east along Xingang Donglu; north of the Pearl Promenade halls 6.1, 7.1, 8.1;
 *    outdoor areas 6.0 / 8.0 further north, 4.0 / 5.0 east of 8.1.
 *  - Area B: halls 9–11 west → east along Xingang Donglu; 12, 13 north of them; outdoor 9.0 / 12.0 / 13.0 further north.
 *  - Area C: halls 14, 15, 16 south of Xingang Donglu.
 *  - Pearl Promenade runs east–west between the south and north rows of A and B.
 *  - The Middle Platform sits between Area A and Area B on the promenade; from there the link crosses
 *    Xingang Donglu to Area C (landing between halls 15 and 16).
 *  - Area D joins Area A along the Xingang Donglu row (hall 20 / Friendship Hall → hall 1).
 *
 * Levels x.1 … x.4 of a hall are ONE building (vertical transition). Outdoor areas x.0 are separate open areas
 * (map legend "Outdoor Open Area"), not floors of hall x. No booth coordinates: points are bound to halls only.
 */

export type AreaId = 'A' | 'B' | 'C' | 'D';
export type NodeKind = 'hall' | 'outdoor' | 'special';
export type Row = 0 | 1 | 3 | 5;

export interface VNode {
  id: string;
  area: AreaId;
  /** West edge, units. */
  x: number;
  row: Row;
  kind: NodeKind;
  label: string;
}

const node = (id: string, area: AreaId, x: number, row: Row, kind: NodeKind = 'hall', label = id): VNode => ({ id, area, x, row, kind, label });

export const NODES: VNode[] = [
  // Area D — Xingang Donglu row
  node('17', 'D', 0, 3),
  node('18', 'D', 1, 3),
  node('19', 'D', 2, 3),
  node('20', 'D', 2.95, 3),
  node('21', 'D', 4.2, 3, 'special', '21 Friendship'),
  // Area A — Xingang Donglu row
  node('1', 'A', 6.2, 3),
  node('2', 'A', 7.15, 3),
  node('3', 'A', 8.1, 3),
  node('4', 'A', 9.1, 3),
  node('5', 'A', 10.1, 3),
  // Area A — north of Pearl Promenade
  node('6', 'A', 5.9, 1),
  node('7', 'A', 6.85, 1),
  node('8', 'A', 7.9, 1),
  node('4.0', 'A', 8.85, 1, 'outdoor', '4.0'),
  node('5.0', 'A', 9.8, 1, 'outdoor', '5.0'),
  node('6.0', 'A', 5.7, 0, 'outdoor', '6.0'),
  node('8.0', 'A', 8.65, 0, 'outdoor', '8.0'),
  // Area B — Xingang Donglu row
  node('9', 'B', 13.55, 3),
  node('10', 'B', 14.55, 3),
  node('11', 'B', 15.5, 3),
  // Area B — north
  node('12', 'B', 13.9, 1),
  node('13', 'B', 14.9, 1),
  node('9.0', 'B', 12.6, 0, 'outdoor', '9.0'),
  node('12.0', 'B', 13.6, 0, 'outdoor', '12.0'),
  node('13.0', 'B', 14.6, 0, 'outdoor', '13.0'),
  // Area C — south of Xingang Donglu
  node('14', 'C', 11.3, 5),
  node('15', 'C', 12.3, 5),
  node('16', 'C', 13.6, 5),
];

export const AREAS: { id: AreaId; label: string; halls: string }[] = [
  { id: 'D', label: 'Area D', halls: 'Hall 17–20' },
  { id: 'A', label: 'Area A', halls: 'Hall 1–8' },
  { id: 'B', label: 'Area B', halls: 'Hall 9–13' },
  { id: 'C', label: 'Area C', halls: 'Hall 14–16' },
];

/** Box width in units and vertical layout (units) used by both the graph and the map. */
export const BOX_W = 0.875;
export const ROW_TOP: Record<Row, number> = { 0: 0, 1: 1.4, 3: 3.4, 5: 6.55 };
export const ROW_H: Record<Row, number> = { 0: 0.9, 1: 1.2, 3: 2.0, 5: 2.4 };

/** Walkways (units). */
export const Y_NORTH = 1.15; // north service street between outdoor areas and the north halls
export const Y_PROMENADE = 2.95; // Pearl Promenade (A, B) and the D ↔ A connection west of it
export const Y_ROAD_TOP = 5.6;
export const Y_ROAD_BOTTOM = 6.0; // Xingang Donglu
export const Y_C = 6.3; // Area C forecourt
export const X_XILU = 5.55; // along Zhanchang Xilu (west edge of Area A north part)
export const X_MIDDLE = 11.8; // Middle Platform / link to Area C (between Area A and Area B)
export const X_DONGLU = 16.55; // along Zhanchang Donglu (east edge of Area B)
export const X_PROMENADE_WEST = 5.55;
export const X_MIN = 0;
export const X_MAX = X_DONGLU + 0.4;
export const Y_MAX = ROW_TOP[5] + ROW_H[5];

const ROAD_CROSSING_EXTRA = 1.2;
const VERTICAL_COST = 0.35; // escalator per level inside one building
const BUILDING_CHANGE = 1.5; // leaving a building costs extra, so its floors are finished together
const UNKNOWN_COST = 50;

export const NODE_BY_ID = new Map(NODES.map((n) => [n.id, n]));

export function splitHall(h: string): { building: number; floor: number } {
  const [b, f] = h.split('.');
  return { building: Number(b) || 0, floor: Number(f) || 0 };
}

/** Map/graph node of a hall: "15.2" → "15", outdoor "8.0" → "8.0". */
export function nodeOfHall(h: string): string {
  const { building, floor } = splitHall(h);
  return floor === 0 ? `${building}.0` : String(building);
}

export function areaOf(building: number): { id: AreaId; label: string } | undefined {
  const n = NODE_BY_ID.get(String(building));
  return n ? AREAS.find((a) => a.id === n.area) : undefined;
}

type Pt = { x: number; y: number };
const centerX = (n: VNode) => n.x + BOX_W / 2;

/** Doors of a node: where it meets a walkway. */
function doors(n: VNode): { door: Pt; street: Pt }[] {
  const cx = centerX(n);
  const top = ROW_TOP[n.row];
  const bottom = top + ROW_H[n.row];
  switch (n.row) {
    case 0:
      return [{ door: { x: cx, y: bottom }, street: { x: cx, y: Y_NORTH } }];
    case 1:
      return [
        { door: { x: cx, y: top }, street: { x: cx, y: Y_NORTH } },
        { door: { x: cx, y: bottom }, street: { x: cx, y: Y_PROMENADE } },
      ];
    case 3:
      return [{ door: { x: cx, y: top }, street: { x: cx, y: Y_PROMENADE } }];
    case 5:
      return [{ door: { x: cx, y: top }, street: { x: cx, y: Y_C } }];
  }
}

// ---- walkway graph -------------------------------------------------------
const key = (p: Pt) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`;
const PTS = new Map<string, Pt>();
const ADJ = new Map<string, { to: string; cost: number }[]>();

function addEdge(a: Pt, b: Pt, extra = 0) {
  const ka = key(a);
  const kb = key(b);
  if (ka === kb) return;
  PTS.set(ka, a);
  PTS.set(kb, b);
  const cost = Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + extra;
  ADJ.set(ka, [...(ADJ.get(ka) ?? []), { to: kb, cost }]);
  ADJ.set(kb, [...(ADJ.get(kb) ?? []), { to: ka, cost }]);
}

function chain(points: Pt[], axis: 'x' | 'y', extraFor?: (a: Pt, b: Pt) => number) {
  const uniq = Array.from(new Map(points.map((p) => [key(p), p])).values()).sort((a, b) => a[axis] - b[axis]);
  for (let i = 1; i < uniq.length; i++) addEdge(uniq[i - 1], uniq[i], extraFor?.(uniq[i - 1], uniq[i]) ?? 0);
}

{
  const onNorth: Pt[] = [{ x: X_XILU, y: Y_NORTH }, { x: X_MIDDLE, y: Y_NORTH }, { x: X_DONGLU, y: Y_NORTH }];
  const onProm: Pt[] = [{ x: X_XILU, y: Y_PROMENADE }, { x: X_MIDDLE, y: Y_PROMENADE }, { x: X_DONGLU, y: Y_PROMENADE }];
  const onC: Pt[] = [{ x: X_MIDDLE, y: Y_C }];
  for (const n of NODES) {
    if (n.kind === 'special') continue;
    for (const d of doors(n)) {
      addEdge(d.door, d.street);
      (d.street.y === Y_NORTH ? onNorth : d.street.y === Y_PROMENADE ? onProm : onC).push(d.street);
    }
  }
  chain(onNorth, 'x');
  chain(onProm, 'x');
  chain(onC, 'x');
  // North–south links: Zhanchang Xilu side, Middle Platform (down to Area C over Xingang Donglu), Zhanchang Donglu side.
  chain([{ x: X_XILU, y: Y_NORTH }, { x: X_XILU, y: Y_PROMENADE }], 'y');
  chain([{ x: X_DONGLU, y: Y_NORTH }, { x: X_DONGLU, y: Y_PROMENADE }], 'y');
  chain(
    [{ x: X_MIDDLE, y: Y_NORTH }, { x: X_MIDDLE, y: Y_PROMENADE }, { x: X_MIDDLE, y: Y_C }],
    'y',
    (a, b) => (a.y === Y_PROMENADE && b.y === Y_C ? ROAD_CROSSING_EXTRA : 0),
  );
}

function dijkstra(from: string[]): { dist: Map<string, number>; prev: Map<string, string> } {
  const dist = new Map<string, number>();
  const prev = new Map<string, string>();
  const todo = new Set(PTS.keys());
  for (const f of from) dist.set(f, 0);
  while (todo.size) {
    let best: string | null = null;
    for (const k of todo) if (dist.has(k) && (best === null || dist.get(k)! < dist.get(best)!)) best = k;
    if (best === null) break;
    todo.delete(best);
    for (const e of ADJ.get(best) ?? []) {
      const nd = dist.get(best)! + e.cost;
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        prev.set(e.to, best);
      }
    }
  }
  return { dist, prev };
}

const doorKeys = (id: string) => {
  const n = NODE_BY_ID.get(id);
  return n ? doors(n).map((d) => key(d.door)) : [];
};

const SSSP = new Map<string, ReturnType<typeof dijkstra>>();
function sssp(id: string) {
  if (!SSSP.has(id)) SSSP.set(id, dijkstra(doorKeys(id)));
  return SSSP.get(id)!;
}

function nodeDistance(a: string, b: string): number {
  const { dist } = sssp(a);
  return Math.min(...doorKeys(b).map((k) => dist.get(k) ?? Infinity));
}

/** Orthogonal walkway polyline (units) between two nodes, door to door. */
export function walkPath(aHall: string, bHall: string): Pt[] {
  const a = nodeOfHall(aHall);
  const b = nodeOfHall(bHall);
  if (a === b || !NODE_BY_ID.has(a) || !NODE_BY_ID.has(b)) return [];
  const { dist, prev } = sssp(a);
  const end = doorKeys(b).sort((x, y) => (dist.get(x) ?? Infinity) - (dist.get(y) ?? Infinity))[0];
  if (!end || !dist.has(end)) return [];
  const out: Pt[] = [];
  for (let k: string | undefined = end; k; k = prev.get(k)) out.unshift(PTS.get(k)!);
  return out;
}

/** Pedestrian cost between two halls (e.g. "15.2" → "9.1") over the walkway graph. */
export function hallCost(a: string | null, b: string): number {
  if (!a) return 0;
  if (a === b) return 0;
  const pa = splitHall(a);
  const pb = splitHall(b);
  const vertical = Math.abs(pa.floor - pb.floor) * VERTICAL_COST;
  const na = nodeOfHall(a);
  const nb = nodeOfHall(b);
  if (na === nb) return vertical;
  if (!NODE_BY_ID.has(na) || !NODE_BY_ID.has(nb)) return UNKNOWN_COST + Math.abs(pa.building - pb.building);
  const walk = nodeDistance(na, nb);
  if (!Number.isFinite(walk)) return UNKNOWN_COST + Math.abs(pa.building - pb.building);
  return walk + BUILDING_CHANGE + vertical;
}
