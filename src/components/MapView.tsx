import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ALL_HALLS, POINTS, compareHalls } from '../data';
import { GROUP_LEGEND, groupColor } from '../groups';
import type { Plan, Step } from '../route';
import type { GeoQuality } from '../geo';
import type { GpsFix, GpsStatus } from '../useGps';
import type { Point, PointState } from '../types';
import { Directions, GroupTag, PathLine, PriorityBadge } from './common';
import { STREETS, boothsLabel, hallLabel, isOutdoor, type From } from '../labels';
import { LegLine, SuggestBanner } from './LegInfo';
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
  Y_SOUTH,
  Y_ROAD_BOTTOM,
  Y_ROAD_TOP,
  nodeOfHall,
  walkPath,
  type Pt,
} from '../venue';

export interface LegInfo {
  meters: number;
  minutes: number;
  sameHall: boolean;
  /** A path (or "same hall") is known — false when there is neither GPS nor a current hall. */
  known: boolean;
  fromGps: boolean;
  approx: boolean;
  /** How the distance was obtained. */
  via?: 'walkways' | 'amap' | 'straight';
}

export interface GpsView {
  status: GpsStatus;
  message: string;
  fix: GpsFix | null;
  venue: Pt | null;
  inside: boolean;
  usable: boolean;
  quality: GeoQuality;
  mPerUnit: number;
  hallGuess: string | null;
  outsideMeters: number | null;
  target: { lat: number; lon: number } | null;
}

interface Props {
  plan: Plan;
  states: Record<number, PointState>;
  current: string | null;
  focusHall: string | null;
  onHall: (hall: string) => void;
  gps: GpsView;
  legPath: Pt[];
  leg: LegInfo | null;
  suggest: { savingM: number } | null;
  onReplan: () => void;
  onDismissSuggest: () => void;
  onVisited: (id: number) => void;
  onOpen: (id: number) => void;
  onCalibrate: (hall: string) => void;
  onEnableGps: () => void;
  onPickHall: () => void;
  from: From;
}

const QUALITY_LABEL: Record<GeoQuality, string> = {
  approx: 'привязка ≈ ±100 м (по метро)',
  partial: 'привязка уточнена по 1 павильону',
  calibrated: 'привязка уточнена на месте',
  real: 'привязка по реальным координатам павильонов',
};

const U = 80; // px per venue unit
const PAD = 20;
const TOP = 62;
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

export function MapView({ plan, states, current, focusHall, onHall, gps, legPath, leg, suggest, onReplan, onDismissSuggest, onVisited, onOpen, onCalibrate, onEnableGps, onPickHall, from }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(false);
  const [boxW, setBoxW] = useState(360);
  const [boxH, setBoxH] = useState(360);
  const [follow, setFollow] = useState(false);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setBoxW(el.clientWidth);
      setBoxH(el.clientHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Auto zoom so that "Вы здесь" and point #1 are both visible when the map opens.
  const userRaw = gps.venue && gps.inside ? { x: px(gps.venue.x), y: py(gps.venue.y) } : null;
  const firstRaw = plan.stops[0] ? chipBox(plan.stops[0].hall) : null;
  const pairZoom =
    userRaw && firstRaw && !focusHall
      ? Math.max(
          0.45,
          Math.min(1, (boxW - 70) / (Math.abs(userRaw.x - (firstRaw.x + firstRaw.w / 2)) + 1), (boxH - 70) / (Math.abs(userRaw.y - (firstRaw.y + firstRaw.h / 2)) + 1)),
        )
      : 1;
  const scale = fit ? boxW / W : pairZoom;

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

  const centerOn = (x: number, y: number) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ left: Math.max(0, x * scale - el.clientWidth / 2), top: Math.max(0, y * scale - el.clientHeight / 2), behavior: 'smooth' });
  };

  const userPx = gps.venue && gps.inside ? { x: px(gps.venue.x), y: py(gps.venue.y) } : null;

  // Explicit focus → that hall; otherwise show "Вы здесь" and point #1 together.
  const firstChipNow = plan.stops[0] ? chipBox(plan.stops[0].hall) : null;
  const both = !focusHall && userPx && firstChipNow ? { x: (userPx.x + firstChipNow.x + firstChipNow.w / 2) / 2, y: (userPx.y + firstChipNow.y) / 2 } : null;
  useEffect(() => {
    if (fit || (follow && userPx)) return;
    if (both) return centerOn(both.x, both.y);
    const c = target ? chipBox(target) : null;
    if (c) centerOn(c.x + c.w / 2, c.y + c.h / 2);
  }, [target, fit, scale, !!both, plan.stops[0]?.hall]);

  // Follow mode: keep the user in view while walking.
  useEffect(() => {
    if (follow && userPx && !fit) centerOn(userPx.x, userPx.y);
  }, [follow, userPx?.x, userPx?.y, fit]);

  const locate = () => {
    if (gps.status === 'off' || gps.status === 'denied' || gps.status === 'error') onEnableGps();
    if (userPx) {
      setFit(false);
      centerOn(userPx.x, userPx.y);
    }
  };

  const halls = Array.from(new Set([...ALL_HALLS, ...(current ? [current] : [])])).filter((h) => chipBox(h));

  // Full route between stops (calm), and the active leg: GPS / current hall → stop 1 (prominent).
  const stopHalls = plan.stops.map((s) => s.hall).filter((h, i, arr) => h !== arr[i - 1]);
  const legs = stopHalls.slice(1).map((h, i) => legPoints(stopHalls[i], h)).filter((x): x is string => !!x);
  const firstStop = plan.stops[0];
  const firstChip = firstStop ? chipBox(firstStop.hall) : null;
  let activeLeg: string | null = null;
  let approxLeg: string | null = null;
  if (firstStop && firstChip) {
    const end = { x: firstChip.x + firstChip.w / 2, y: firstChip.y + firstChip.h / 2 };
    if (gps.usable && userPx) {
      const pts = legPath.map((p) => ({ x: px(p.x), y: py(p.y) }));
      if (pts.length >= 2) {
        approxLeg = `${pts[0].x},${pts[0].y} ${pts[1].x},${pts[1].y}`;
        activeLeg = [...pts.slice(1), end].map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
      } else {
        approxLeg = `${userPx.x},${userPx.y} ${end.x},${end.y}`;
      }
    } else if (current && current !== firstStop.hall) {
      activeLeg = legPoints(current, firstStop.hall);
    }
  }
  const step1 = plan.steps[0];
  const badgeColor = (hall: string) => {
    const st = plan.stops.find((s) => s.hall === hall);
    return st ? groupColor(st.points[0].mapGroup) : undefined;
  };

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
        <button className="toggle locate" onClick={locate}>
          📍 Моё местоположение
        </button>
        <button className="toggle" onClick={() => setFit(!fit)}>
          {fit ? '🔍 Крупно' : '⤢ Весь комплекс'}
        </button>
      </div>
      <GpsPanel gps={gps} current={current} onCalibrate={onCalibrate} onEnableGps={onEnableGps} onPickHall={onPickHall} />
      {suggest && <SuggestBanner savingM={suggest.savingM} onReplan={onReplan} onDismiss={onDismissSuggest} />}
      {step1 && (
        <NextSheet
          from={from}
          step={step1}
          leg={leg}
          follow={follow}
          onOpen={onOpen}
          onVisited={onVisited}
          onToggleFollow={() => {
            const next = !follow;
            setFollow(next);
            if (next) {
              setFit(false);
              if (userPx) centerOn(userPx.x, userPx.y);
              else if (firstChip) centerOn(firstChip.x + firstChip.w / 2, firstChip.y + firstChip.h / 2);
            }
          }}
        />
      )}

      <div className="map-scroll" ref={scroller}>
        <svg width={W * scale} height={H * scale} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Схема Canton Fair Complex">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className="route-arrow" />
            </marker>
            <marker id="arrow-active" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className="active-arrow" />
            </marker>
          </defs>

          <StreetLabel x={W / 2} y={16} s={STREETS.yuejiang} anchor="middle" note="север" />

          {AREAS.map((a) => {
            const b = areaBox(a.id);
            return (
              <g key={a.id}>
                <rect x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0} rx={14} className="area-box" />
                <text x={b.x0 + 10} y={b.y1 - 7} className="area-label">
                  {a.label.replace('Area', 'Зона')} · {a.halls.replace('Hall', 'павильоны')}
                </text>
              </g>
            );
          })}

          {/* Xingang Donglu */}
          <rect x={PAD} y={py(Y_ROAD_TOP)} width={W - PAD * 2} height={(Y_ROAD_BOTTOM - Y_ROAD_TOP) * U} className="road" />
          <StreetLabel x={px(0.2)} y={py(Y_ROAD_TOP) + 13} s={STREETS.xingang} />

          {/* walkways */}
          <line x1={px(X_XILU)} y1={py(Y_NORTH)} x2={px(X_DONGLU)} y2={py(Y_NORTH)} className="walkway" />
          <line x1={px(0.44)} y1={py(Y_SOUTH)} x2={px(15.94)} y2={py(Y_SOUTH)} className="walkway" />
          <line x1={px(X_XILU)} y1={py(Y_NORTH)} x2={px(X_XILU)} y2={py(Y_PROMENADE)} className="walkway" />
          <line x1={px(X_DONGLU)} y1={py(Y_NORTH)} x2={px(X_DONGLU)} y2={py(Y_PROMENADE)} className="walkway" />
          <line x1={px(X_MIDDLE)} y1={py(Y_NORTH)} x2={px(X_MIDDLE)} y2={py(Y_PROMENADE)} className="walkway" />
          <StreetLabel x={px(X_XILU) - 4} y={py(Y_NORTH) + 34} s={STREETS.xilu} anchor="end" small />
          <StreetLabel x={px(X_DONGLU) + 4} y={py(Y_NORTH) + 34} s={STREETS.donglu} small />
          <StreetLabel x={px(X_MIDDLE) + 6} y={py(Y_NORTH) + 70} s={STREETS.zhonglu} small />

          <rect x={px(X_PROMENADE_WEST)} y={py(Y_PROMENADE) - 7} width={px(X_DONGLU) - px(X_PROMENADE_WEST)} height={14} rx={7} className="promenade" />
          <text x={px(6.3)} y={py(Y_PROMENADE) + 3.5} className="promenade-label">
            Pearl Promenade (галерея)
          </text>
          <rect x={px(0.3)} y={py(Y_PROMENADE) - 4} width={px(X_PROMENADE_WEST) - px(0.3)} height={8} rx={4} className="corridor" />
          <text x={px(0.4)} y={py(Y_PROMENADE) - 8} className="corridor-label">
            переход D ↔ A
          </text>

          {/* Middle Platform and the link over Xingang Donglu to Area C */}
          <rect x={px(X_MIDDLE) - 7} y={py(Y_PROMENADE)} width={14} height={py(Y_C) - py(Y_PROMENADE)} rx={5} className="link" />
          <line x1={px(X_MIDDLE)} y1={py(Y_C)} x2={px(13.6 + BOX_W / 2)} y2={py(Y_C)} className="walkway" />

          {/* Entrances: halls open on the north and south sides (CIEFC); gate numbers are not confirmed, so none are shown. */}
          {ENTRANCES.map((e) => (
            <g key={e.label} className="entrance">
              <rect x={px(e.x) - 44} y={py(e.y) - 9} width={88} height={18} rx={9} />
              <text x={px(e.x)} y={py(e.y) + 4} textAnchor="middle">
                {e.label}
              </text>
            </g>
          ))}
          <text x={px(X_MIDDLE) + 10} y={py(Y_ROAD_TOP) + 18} className="crossing-label">
            переход через ул. Синган-Дунлу
          </text>
          {NODES.map((n) => {
            const b = nodeBox(n.id);
            const used = LEVELS.has(n.id);
            return (
              <g key={n.id}>
                <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={8} className={`bld ${used ? 'bld-used' : ''} ${n.kind !== 'hall' ? `bld-${n.kind}` : ''}`} />
                <text x={b.x + b.w / 2} y={b.y + 15} textAnchor="middle" className="bld-num">
                  {n.kind === 'outdoor' ? `Площадка ${n.id.split('.')[0]}` : n.kind === 'special' ? 'Friendship Hall' : `Павильон ${n.label}`}
                </text>
              </g>
            );
          })}

          {legs.map((pts, i) => (
            <polyline key={i} points={pts} className="route-line" markerEnd="url(#arrow)" />
          ))}
          {approxLeg && <polyline points={approxLeg} className="active-approx" />}
          {activeLeg && <polyline points={activeLeg} className="active-leg" markerEnd="url(#arrow-active)" />}

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
                aria-label={`${hallLabel(h)}: ${routed} по маршруту, ${pending.length} из ${all.length} осталось`}
              >
                <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={7} className="chip-bg" />
                <text x={c.x + 6} y={c.y + 13} className="chip-hall">
                  {isOutdoor(h) ? 'улица' : `${h.split('.')[1]} этаж`}
                </text>
                <text x={c.x + 6} y={c.y + 22} className="chip-code">
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
                    <circle cx={c.x - 2} cy={c.y + 2} r={10} className="order-dot" style={{ fill: badgeColor(h) }} />
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

          {userPx && gps.fix && (
            <g className="user" aria-label="Вы здесь">
              <circle cx={userPx.x} cy={userPx.y} r={Math.min(400, (gps.fix.acc / gps.mPerUnit) * U)} className="user-acc" />
              <circle cx={userPx.x} cy={userPx.y} r={9} className="user-dot" />
              <text x={userPx.x} y={userPx.y - 15} textAnchor="middle" className="user-label">
                Вы здесь
              </text>
            </g>
          )}
        </svg>
      </div>

      <div className="map-keys small">
        <span><i className="k k-current" /> где вы сейчас</span>
        <span><i className="k k-next" /> следующий павильон</span>
        <span><i className="k k-door">вход</i> вход (сторона подтверждена, номер ворот — нет)</span>
        <span><i className="k k-user" /> вы здесь (GPS)</span>
        <span><i className="k k-active" /> текущий участок</span>
        <span><i className="k k-order">1</i> порядок обхода · цвет = товарная группа</span>
        <span>число — точек по маршруту</span>
        <span>«доп.» — второй стенд компании, визит в другом павильоне</span>
        <span>внутри павильона — его этажи (мелко — код, напр. 15.2)</span>
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
        Расположение зон и павильонов — по официальному Exhibition Section Floor Map 140-й сессии (Phase 1) и Complex Layout.
        Линии маршрута идут по проходам: Pearl Promenade, Middle Platform, переход через Xingang Donglu. Пунктир от синей
        точки — приблизительный путь до ближайшего прохода. Внутри павильона порядок — по номерам стендов (не GPS): координат
        стендов нет, точки привязаны к павильонам. GPS внутри павильонов может ошибаться на десятки метров.
      </p>
    </div>
  );
}


export function GpsPanel({ gps, current, onCalibrate, onEnableGps, onPickHall }: Pick<Props, 'gps' | 'current' | 'onCalibrate' | 'onEnableGps' | 'onPickHall'>) {
  if (gps.status === 'off')
    return (
      <div className="gps-panel">
        <span>GPS выключен.</span>
        <button className="btn-link" onClick={onEnableGps}>
          Включить
        </button>
      </div>
    );
  if (gps.status === 'waiting' && !gps.fix) return <div className="gps-panel">📡 Ищу GPS… разрешите доступ к геопозиции</div>;
  if (!gps.fix)
    return (
      <div className="gps-panel warn">
        <span>{gps.message || 'GPS недоступен.'} Маршрут строится от выбранного павильона.</span>
        <button className="btn-link" onClick={onPickHall}>
          Выбрать Hall
        </button>
      </div>
    );
  const acc = Math.round(gps.fix.acc);
  if (!gps.inside) {
    const t = gps.target;
    return (
      <div className="gps-panel warn">
        <span>
          Вы вне комплекса: ≈ {gps.outsideMeters ? (gps.outsideMeters / 1000).toFixed(1).replace('.', ',') : '?'} км. Путь по улицам —
          в навигаторе:
        </span>
        {t && (
          <span className="gps-links">
            <a className="chip-btn" href={`https://maps.apple.com/?daddr=${t.lat.toFixed(6)},${t.lon.toFixed(6)}&dirflg=w`} target="_blank" rel="noopener noreferrer">
              Apple Maps
            </a>
            <a className="chip-btn" href={`https://uri.amap.com/navigation?to=${t.lon.toFixed(6)},${t.lat.toFixed(6)},Canton%20Fair&mode=walk&coordinate=wgs84&callnative=1`} target="_blank" rel="noopener noreferrer">
              Amap
            </a>
          </span>
        )}
      </div>
    );
  }
  return (
    <div className={`gps-panel ${gps.usable ? 'ok' : 'warn'}`}>
      <span>
        🔵 GPS ±{acc} м{gps.hallGuess ? ` · похоже, павильон ${gps.hallGuess}` : ''} · {QUALITY_LABEL[gps.quality]}
        {!gps.usable && ' · точность низкая, маршрут от выбранного павильона'}
      </span>
      {current && acc <= 60 && (
        <button className="btn btn-mark" onClick={() => onCalibrate(current)}>
          📍 Отметить: я здесь — {hallLabel(current)}
          {gps.hallGuess && gps.hallGuess !== nodeOfHall(current) ? ` (GPS показывает павильон ${gps.hallGuess})` : ''}
        </button>
      )}
      {current && acc > 60 && <span className="muted">Для отметки павильона нужна точность GPS ±60 м</span>}
      {current && (
        <button className="btn-link" onClick={onPickHall}>
          Другой павильон
        </button>
      )}
      {!current && (
        <button className="btn-link" onClick={onPickHall}>
          Выбрать Hall, чтобы отметить его на карте
        </button>
      )}
    </div>
  );
}

export function NextSheet({ step, leg, follow, onToggleFollow, onOpen, onVisited, from }: {
  step: Step;
  from: From;
  leg: LegInfo | null;
  follow: boolean;
  onToggleFollow: () => void;
  onOpen: (id: number) => void;
  onVisited: (id: number) => void;
}) {
  return (
    <div className="next-sheet">
      <div className="ns-top">
        <span className="ns-num" style={{ background: groupColor(step.point.mapGroup) }}>1</span>
        <span className="ns-label">Следующая точка</span>
        <PriorityBadge p={step.point} />
      </div>
      <div className="ns-where">{hallLabel(step.hall)}</div>
      <div className="ns-booth">Стенд {boothsLabel(step.booths)}</div>
      <div className="ns-row">
        <button className="ns-company" onClick={() => onOpen(step.point.id)}>
          {step.point.company} ›
        </button>
        <GroupTag group={step.point.mapGroup} short />
      </div>
      {leg && <LegLine leg={leg} />}
      <Directions from={from} hall={step.hall} booths={step.booths} />
      <PathLine hall={step.hall} booths={step.booths} />
      <div className="ns-btns">
        <button className={`btn ${follow ? 'btn-secondary' : 'btn-start'}`} onClick={onToggleFollow}>
          {follow ? '■ Остановить' : '▶ Начать маршрут'}
        </button>
        <button className="btn btn-visit" onClick={() => onVisited(step.point.id)}>
          ✓ Посетила
        </button>
      </div>
    </div>
  );
}

/** Entrance tags placed on the side of each zone where entrances exist (positions along the side are schematic). */
const ENTRANCES: { x: number; y: number; label: string }[] = [
  { x: 1.9, y: 5.52, label: 'Вход в Зону D' },
  { x: 8.6, y: 5.52, label: 'Вход в Зону A' },
  { x: 14.95, y: 5.52, label: 'Вход в Зону B' },
  { x: 8.2, y: -0.25, label: 'Вход в Зону A' },
  { x: 14.6, y: -0.25, label: 'Вход в Зону B' },
  { x: 12.9, y: 6.3, label: 'Вход в Зону C' },
];

function StreetLabel({ x, y, s, anchor = 'start', small, note }: { x: number; y: number; s: { ru: string; en: string; zh: string }; anchor?: 'start' | 'middle' | 'end'; small?: boolean; note?: string }) {
  return (
    <text x={x} y={y} textAnchor={anchor} className={small ? 'lane-label' : 'road-label'}>
      <tspan className="street-ru">{s.ru}</tspan>
      <tspan x={x} dy={small ? 10 : 12} className="street-en">
        {s.en}
        {s.zh ? ` · ${s.zh}` : ''}
        {note ? ` · ${note}` : ''}
      </tspan>
    </text>
  );
}
