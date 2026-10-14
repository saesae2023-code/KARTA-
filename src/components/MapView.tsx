import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ALL_HALLS, POINTS, compareHalls } from '../data';
import { GROUP_LEGEND, groupColor } from '../groups';
import type { Plan } from '../route';
import type { Point, PointState } from '../types';
import { AB_JUNCTION_X, AREAS, BUILDING_POS, VENUE_NOTES, splitHall } from '../venue';

interface Props {
  plan: Plan;
  states: Record<number, PointState>;
  current: string | null;
  focusHall: string | null;
  onHall: (hall: string) => void;
}

const U = 80; // px per schematic unit
const BW = 70; // building width
const BH = 156; // building height
const PAD = 20;
const Y0 = 64;
const Y1 = Y0 + BH + 70;
const CHIP_H = 28;
const CHIP_GAP = 4;
const MAX_X = Math.max(...Object.values(BUILDING_POS).map((p) => p.x));
const W = PAD * 2 + MAX_X * U + BW;
const H = Y1 + BH + PAD;

function buildingBox(b: number) {
  const pos = BUILDING_POS[b];
  return { x: PAD + pos.x * U, y: pos.row === 0 ? Y0 : Y1 };
}

/** Floors that hold at least one point, top floor first (as seen on a section). */
const FLOORS: Map<number, string[]> = (() => {
  const m = new Map<number, string[]>();
  for (const h of ALL_HALLS) {
    const { building } = splitHall(h);
    m.set(building, [...(m.get(building) ?? []), h]);
  }
  for (const [b, hs] of m) m.set(b, hs.sort(compareHalls).reverse());
  return m;
})();

function chipBox(hall: string) {
  const { building } = splitHall(hall);
  const floors = FLOORS.get(building) ?? [hall];
  const i = Math.max(0, floors.indexOf(hall));
  const box = buildingBox(building);
  return { x: box.x + 4, y: box.y + 26 + i * (CHIP_H + CHIP_GAP), w: BW - 8, h: CHIP_H };
}

export function pointsInHall(hall: string): Point[] {
  return POINTS.filter((p) => p.halls.includes(hall));
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
    if (!el || !target || fit) return;
    const c = chipBox(target);
    el.scrollTo({ left: Math.max(0, (c.x + c.w / 2) * scale - el.clientWidth / 2), behavior: 'smooth' });
  }, [target, fit, scale]);

  // Route polyline: current hall → stop 1 → stop 2 …
  const pathHalls = [...(current && ALL_HALLS.includes(current) ? [current] : []), ...plan.stops.map((s) => s.hall)];
  // Moves between the north row and Area C go through the road crossing, not straight across the map.
  const crossTop = `${PAD + AB_JUNCTION_X * U + BW / 2},${Y0 + BH - 6}`;
  const crossBottom = `${buildingBox(15).x + BW / 2},${Y1 - 30}`;
  const pts: string[] = [];
  pathHalls
    .filter((h, i) => h !== pathHalls[i - 1])
    .forEach((h, i, arr) => {
      const c = chipBox(h);
      if (i > 0) {
        const r0 = BUILDING_POS[splitHall(arr[i - 1]).building]?.row;
        const r1 = BUILDING_POS[splitHall(h).building]?.row;
        if (r0 !== undefined && r1 !== undefined && r0 !== r1) pts.push(...(r0 === 0 ? [crossTop, crossBottom] : [crossBottom, crossTop]));
      }
      pts.push(`${c.x + c.w / 2},${c.y + c.h / 2}`);
    });

  return (
    <div className="map">
      <div className="map-toolbar">
        <span className="small muted">Схема по официальному layout, не в масштабе · точки привязаны к Hall</span>
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

          {AREAS.map((a) => {
            const xs = a.buildings.map((b) => buildingBox(b).x);
            const y = buildingBox(a.buildings[0]).y;
            const x0 = Math.min(...xs) - 8;
            const x1 = Math.max(...xs) + BW + 8;
            return (
              <g key={a.id}>
                <rect x={x0} y={y - 30} width={x1 - x0} height={BH + 38} rx={14} className="area-box" />
                <text x={x0 + 10} y={y - 11} className="area-label">
                  {a.label} · Hall {Math.min(...a.buildings)}–{Math.max(...a.buildings)}
                </text>
              </g>
            );
          })}
          <rect x={PAD} y={Y0 + BH + 18} width={W - PAD * 2} height={24} className="road" />
          <text x={PAD + 12} y={Y0 + BH + 35} className="road-label">
            Xingang Dong Rd
          </text>

          {/* Pearl River Promenade: east–west through Areas A and B (official) */}
          <rect x={buildingBox(1).x} y={Y0 + BH - 12} width={buildingBox(13).x + BW - buildingBox(1).x} height={12} rx={6} className="promenade" />
          <text x={buildingBox(4).x} y={Y0 + BH - 2.5} className="promenade-label">
            Pearl River Promenade
          </text>

          {/* Connecting Corridor D ↔ A (official) */}
          <rect x={buildingBox(20).x + BW} y={Y0 + 48} width={buildingBox(1).x - buildingBox(20).x - BW} height={16} className="corridor" />
          <text x={(buildingBox(20).x + BW + buildingBox(1).x) / 2} y={Y0 + 44} textAnchor="middle" className="corridor-label">
            Corridor
          </text>

          {/* Xingang Dong Rd crossing (position approximate) */}
          <line x1={PAD + AB_JUNCTION_X * U + BW / 2} y1={Y0 + BH} x2={buildingBox(15).x + BW / 2} y2={Y1 - 30} className="crossing" />
          <text x={PAD + AB_JUNCTION_X * U + BW / 2 + 8} y={Y0 + BH + 58} className="crossing-label">
            ≈ переход A/B ↔ C
          </text>

          {AREAS.flatMap((a) =>
            a.buildings.map((b) => {
              const box = buildingBox(b);
              const floors = FLOORS.get(b);
              return (
                <g key={b}>
                  <rect x={box.x} y={box.y} width={BW} height={BH - 16} rx={8} className={`bld ${floors ? 'bld-used' : ''}`} />
                  <text x={box.x + BW / 2} y={box.y + 18} textAnchor="middle" className="bld-num">
                    {b}
                  </text>
                </g>
              );
            }),
          )}

          {pts.length > 1 && <polyline points={pts.join(' ')} className="route-line" markerEnd="url(#arrow)" markerMid="url(#arrow)" />}

          {ALL_HALLS.map((h) => {
            const c = chipBox(h);
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
                  {routed ? routed : extraOnly ? 'доп.' : '✓'}
                </text>
                {segs.map((s, i) => (
                  <rect key={i} x={s.x} y={c.y + c.h - 6} width={s.w} height={3} fill={s.color} />
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
                  <text x={c.x + c.w / 2} y={c.y - 3} textAnchor="middle" className="here-label">
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
      <h3>Геометрия комплекса</h3>
      <ul className="venue-notes">
        {VENUE_NOTES.map((n) => (
          <li key={n.text} className={n.basis}>
            <span className="basis">{n.basis === 'official' ? '✓ official' : '≈ approx'}</span> {n.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
