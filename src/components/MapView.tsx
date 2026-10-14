import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ALL_HALLS, POINTS, compareHalls } from '../data';
import { GROUP_LEGEND, groupColor } from '../groups';
import type { Plan } from '../route';
import type { Point, PointState } from '../types';
import {
  AREAS,
  BOX_W,
  NODES,
  NODE_BY_ID,
  ROW_H,
  ROW_TOP,
  X_DONGLU,
  X_MAX,
  X_MIDDLE,
  X_PROMENADE_WEST,
  X_XILU,
  Y_C,
  Y_MAX,
  Y_NORTH,
  Y_PROMENADE,
  Y_ROAD_BOTTOM,
  Y_ROAD_TOP,
  nodeOfHall,
  walkPath,
} from '../venue';

interface Props {
  plan: Plan;
  states: Record<number, PointState>;
  current: string | null;
  focusHall: string | null;
  onHall: (hall: string) => void;
}

const U = 80; // px per venue unit
const PAD = 20;
const TOP = 34;
const BW = BOX_W * U;
const CHIP_H = 26;
const CHIP_STEP = 30;
const W = PAD * 2 + X_MAX * U;
const H = TOP + Y_MAX * U + 40;

const px = (x: number) => PAD + x * U;
const py = (y: number) => TOP + y * U;

/** Halls with points, grouped by map node, top level first. */
const LEVELS: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const h of ALL_HALLS) {
    const id = nodeOfHall(h);
    m.set(id, [...(m.get(id) ?? []), h]);
  }
  for (const [id, hs] of m) m.set(id, hs.sort(compareHalls).reverse());
  return m;
})();

function nodeBox(id: string) {
  const n = NODE_BY_ID.get(id)!;
  return { x: px(n.x), y: py(ROW_TOP[n.row]), w: BW, h: ROW_H[n.row] * U };
}

function chipBox(hall: string) {
  const id = nodeOfHall(hall);
  if (!NODE_BY_ID.has(id)) return null;
  const levels = LEVELS.get(id) ?? [hall];
  const i = Math.max(0, levels.indexOf(hall));
  const b = nodeBox(id);
  return { x: b.x + 4, y: b.y + 22 + i * CHIP_STEP, w: BW - 8, h: CHIP_H };
}

export function pointsInHall(hall: string): Point[] {
  return POINTS.filter((p) => p.halls.includes(hall));
}

/** One route leg as an orthogonal polyline: chip → door → walkways → door → chip. */
function legPoints(a: string, b: string): string | null {
  const ca = chipBox(a);
  const cb = chipBox(b);
  if (!ca || !cb) return null;
  const mid = (c: NonNullable<typeof ca>) => ({ x: c.x + c.w / 2, y: c.y + c.h / 2 });
  const walk = walkPath(a, b).map((p) => ({ x: px(p.x), y: py(p.y) }));
  const all = [mid(ca), ...walk, mid(cb)];
  return all.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

export function MapView({ plan, states, current, focusHall, onHall }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(false);
  const [boxW, setBoxW] = useState(360);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = fit ? boxW / W : 1;

  const order = useMemo(() => {
    const m = new Map<string, number[]>();
    plan.stops.forEach((s, i) => m.set(s.hall, [...(m.get(s.hall) ?? []), i + 1]));
    return m;
  }, [plan]);

  const assigned = useMemo(() => {
    const m = new Map<string, number>();
    for (const st of plan.stops) m.set(st.hall, (m.get(st.hall) ?? 0) + st.points.length);
    return m;
  }, [plan]);

  const nextHall = plan.stops.find((s) => s.hall !== current)?.hall ?? null;
  const target = focusHall ?? current ?? plan.stops[0]?.hall ?? null;

  useEffect(() => {
    const el = scroller.current;
    const c = target ? chipBox(target) : null;
    if (!el || !c || fit) return;
    el.scrollTo({
      left: Math.max(0, (c.x + c.w / 2) * scale - el.clientWidth / 2),
      top: Math.max(0, (c.y + c.h / 2) * scale - el.clientHeight / 2),
      behavior: 'smooth',
    });
  }, [target, fit, scale]);

  const halls = Array.from(new Set([...ALL_HALLS, ...(current ? [current] : [])])).filter((h) => chipBox(h));

  const pathHalls = [...(current && chipBox(current) ? [current] : []), ...plan.stops.map((s) => s.hall)].filter(
    (h, i, arr) => h !== arr[i - 1],
  );
  const legs = pathHalls.slice(1).map((h, i) => legPoints(pathHalls[i], h)).filter((x): x is string => !!x);

  const areaBox = (id: string) => {
    const ns = NODES.filter((n) => n.area === id);
    const x0 = Math.min(...ns.map((n) => px(n.x))) - 8;
    const x1 = Math.max(...ns.map((n) => px(n.x) + BW)) + 8;
    const y0 = Math.min(...ns.map((n) => py(ROW_TOP[n.row]))) - 8;
    const y1 = Math.max(...ns.map((n) => py(ROW_TOP[n.row] + ROW_H[n.row]))) + 22;
    return { x0, x1, y0, y1 };
  };

  return (
    <div className="map">
      <div className="map-toolbar">
        <span className="small muted">Официальный Complex Layout (Phase 1), план · точки привязаны к Hall</span>
        <button className="toggle" onClick={() => setFit(!fit)}>
          {fit ? '🔍 Крупно' : '⤢ Весь комплекс'}
        </button>
      </div>
      <div className="map-scroll" ref={scroller}>
        <svg width={W * scale} height={H * scale} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Схема Canton Fair Complex">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className="route-arrow" />
            </marker>
          </defs>

          <text x={W / 2} y={18} textAnchor="middle" className="road-label">
            Yuejiang Zhonglu · север
          </text>

          {AREAS.map((a) => {
            const b = areaBox(a.id);
            return (
              <g key={a.id}>
                <rect x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0} rx={14} className="area-box" />
                <text x={b.x0 + 10} y={b.y1 - 7} className="area-label">
                  {a.label} · {a.halls}
                </text>
              </g>
            );
          })}

          {/* Xingang Donglu */}
          <rect x={PAD} y={py(Y_ROAD_TOP)} width={W - PAD * 2} height={(Y_ROAD_BOTTOM - Y_ROAD_TOP) * U} className="road" />
          <text x={px(0.2)} y={py(Y_ROAD_TOP) + 20} className="road-label">
            Xingang Donglu
          </text>

          {/* walkways */}
          <line x1={px(X_XILU)} y1={py(Y_NORTH)} x2={px(X_DONGLU)} y2={py(Y_NORTH)} className="walkway" />
          <line x1={px(X_XILU)} y1={py(Y_NORTH)} x2={px(X_XILU)} y2={py(Y_PROMENADE)} className="walkway" />
          <line x1={px(X_DONGLU)} y1={py(Y_NORTH)} x2={px(X_DONGLU)} y2={py(Y_PROMENADE)} className="walkway" />
          <line x1={px(X_MIDDLE)} y1={py(Y_NORTH)} x2={px(X_MIDDLE)} y2={py(Y_PROMENADE)} className="walkway" />
          <text x={px(X_XILU) - 4} y={py(Y_NORTH) + 40} className="lane-label" textAnchor="end">
            Zhanchang Xilu
          </text>
          <text x={px(X_DONGLU) + 4} y={py(Y_NORTH) + 40} className="lane-label">
            Zhanchang Donglu
          </text>

          <rect x={px(X_PROMENADE_WEST)} y={py(Y_PROMENADE) - 7} width={px(X_DONGLU) - px(X_PROMENADE_WEST)} height={14} rx={7} className="promenade" />
          <text x={px(6.3)} y={py(Y_PROMENADE) + 3.5} className="promenade-label">
            Pearl Promenade
          </text>
          <rect x={px(0.3)} y={py(Y_PROMENADE) - 4} width={px(X_PROMENADE_WEST) - px(0.3)} height={8} rx={4} className="corridor" />
          <text x={px(0.4)} y={py(Y_PROMENADE) - 8} className="corridor-label">
            D ↔ A
          </text>

          {/* Middle Platform and the link over Xingang Donglu to Area C */}
          <rect x={px(X_MIDDLE) - 7} y={py(Y_PROMENADE)} width={14} height={py(Y_C) - py(Y_PROMENADE)} rx={5} className="link" />
          <line x1={px(X_MIDDLE)} y1={py(Y_C)} x2={px(13.6 + BOX_W / 2)} y2={py(Y_C)} className="walkway" />

          {NODES.map((n) => {
            const b = nodeBox(n.id);
            const used = LEVELS.has(n.id);
            return (
              <g key={n.id}>
                <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={8} className={`bld ${used ? 'bld-used' : ''} ${n.kind !== 'hall' ? `bld-${n.kind}` : ''}`} />
                <text x={b.x + b.w / 2} y={b.y + 15} textAnchor="middle" className="bld-num">
                  {n.kind === 'outdoor' ? 'open area' : n.label}
                </text>
              </g>
            );
          })}

          {legs.map((pts, i) => (
            <polyline key={i} points={pts} className="route-line" markerEnd="url(#arrow)" />
          ))}

          <rect x={px(X_MIDDLE) - 46} y={py(Y_PROMENADE) - 11} width={92} height={22} rx={6} className="platform" />
          <text x={px(X_MIDDLE)} y={py(Y_PROMENADE) + 4} textAnchor="middle" className="platform-label">
            Middle Platform
          </text>

          {halls.map((h) => {
            const c = chipBox(h)!;
            const all = pointsInHall(h);
            const pending = all.filter((p) => states[p.id].visit === 'pending');
            const nums = order.get(h);
            const routed = assigned.get(h) ?? 0;
            const extraOnly = !routed && pending.length > 0;
            const isCur = h === current;
            const isNext = h === nextHall;
            const isFocus = h === focusHall;
            let off = 0;
            const segs = GROUP_LEGEND.map((g) => {
              const n = pending.filter((p) => p.mapGroup === g.group).length;
              const w = pending.length ? (n / pending.length) * (c.w - 8) : 0;
              const seg = { x: c.x + 4 + off, w, color: g.color };
              off += w;
              return seg;
            }).filter((s) => s.w > 0);
            return (
              <g
                key={h}
                className={`chip ${isCur ? 'chip-current' : ''} ${isNext ? 'chip-next' : ''} ${isFocus ? 'chip-focus' : ''} ${pending.length ? '' : 'chip-done'} ${extraOnly ? 'chip-extra' : ''}`}
                onClick={() => onHall(h)}
                role="button"
                aria-label={`Hall ${h}: ${routed} по маршруту, ${pending.length} из ${all.length} осталось`}
              >
                <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={7} className="chip-bg" />
                <text x={c.x + 6} y={c.y + 17} className="chip-hall">
                  {h}
                </text>
                <text x={c.x + c.w - 6} y={c.y + 17} textAnchor="end" className="chip-count">
                  {routed ? routed : extraOnly ? 'доп.' : all.length ? '✓' : ''}
                </text>
                {segs.map((s, i) => (
                  <rect key={i} x={s.x} y={c.y + c.h - 5} width={s.w} height={3} fill={s.color} />
                ))}
                {nums && (
                  <g>
                    <circle cx={c.x - 2} cy={c.y + 2} r={9} className="order-dot" />
                    <text x={c.x - 2} y={c.y + 6} textAnchor="middle" className="order-num">
                      {nums[0]}
                    </text>
                  </g>
                )}
                {isCur && (
                  <text x={c.x + c.w / 2} y={c.y - 2} textAnchor="middle" className="here-label">
                    ВЫ ЗДЕСЬ
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="map-keys small">
        <span><i className="k k-current" /> текущий Hall</span>
        <span><i className="k k-next" /> следующий Hall</span>
        <span><i className="k k-order">1</i> порядок обхода</span>
        <span>число — точек по маршруту</span>
        <span>«доп.» — второй стенд, визит в другом Hall</span>
        <span>этажи x.1–x.4 — один корпус · x.0 — открытая площадка</span>
      </div>

      <h3>Легенда товарных групп</h3>
      <div className="legend">
        {GROUP_LEGEND.map((g) => {
          const left = POINTS.filter((p) => p.mapGroup === g.group && states[p.id].visit === 'pending').length;
          return (
            <div key={g.group} className="legend-row">
              <span className="legend-swatch" style={{ background: groupColor(g.group) }} />
              <span className="legend-name">{g.group}</span>
              <span className="legend-count">
                {g.count} <span className="muted small">/ ост. {left}</span>
              </span>
            </div>
          );
        })}
      </div>
      <p className="muted small">
        Расположение Area и Hall — по официальному Exhibition Section Floor Map 140-й сессии (Phase 1) и Complex Layout.
        Линии маршрута идут по проходам: Pearl Promenade, Middle Platform, переход через Xingang Donglu. Координат стендов
        нет — точки привязаны к Hall.
      </p>
    </div>
  );
}

