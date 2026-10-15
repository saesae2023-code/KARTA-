import { useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { WALK_M_PER_MIN } from '../geo';
import { groupColor } from '../groups';
import type { From } from '../labels';
import { NAV_ICON, navGuide, type NavGuide, type NavState } from '../nav';
import type { Step } from '../route';
import { pathLength, type Pt } from '../venue';
import { GroupTag, PointContact, PriorityBadge, RouteSteps } from './common';
import { formatMeters } from './LegInfo';
import type { LegInfo } from './MapView';

export interface FloatButton {
  key: string;
  label: string;
  title: string;
  on?: boolean;
  onClick: () => void;
}

interface Props {
  step: Step | null;
  leg: LegInfo | null;
  from: From;
  notes?: string;
  /** [Карта][Схема] switch. */
  switcher: ReactNode;
  /** Small floating buttons on the right edge of the map. */
  controls: FloatButton[];
  /** Short one-line notices over the map (suggestion, GPS, far away). */
  pills?: ReactNode;
  /** GPS / data / diagnostics content (sheet behind the GPS chip). */
  info: ReactNode;
  infoLabel: string;
  /** Legend content ("Обозначения"). */
  legend: ReactNode;
  /** Navigation mode and the walking path it follows (venue units). */
  nav: NavState;
  onNav: (n: NavState) => void;
  navPath: Pt[];
  navOrigin: 'gps' | 'hall' | 'entrance' | null;
  mPerUnit: number;
  onOpen: (id: number) => void;
  onVisited: (id: number) => void;
  /** The map itself; fills the stage. */
  children: ReactNode;
}

export type SheetState = 'hidden' | 'collapsed' | 'half' | 'expanded';
const ORDER: SheetState[] = ['hidden', 'collapsed', 'half', 'expanded'];
const SHEET_KEY = 'altiora-map-sheet';

function readSheet(): SheetState {
  try {
    const v = localStorage.getItem(SHEET_KEY);
    return v && (ORDER as string[]).includes(v) ? (v as SheetState) : 'collapsed';
  } catch {
    return 'collapsed';
  }
}
export function saveSheet(v: SheetState) {
  try {
    localStorage.setItem(SHEET_KEY, v);
  } catch {
    /* storage unavailable: state just isn't remembered */
  }
}

const legText = (leg: LegInfo | null) =>
  !leg ? '' : leg.sameHall ? 'вы в этом павильоне' : leg.known ? `${leg.approx ? '≈ ' : ''}${formatMeters(leg.meters)} · ~${leg.minutes} мин` : '';

/** Shared by the schema and AMap: the navigator guide for the current point (null outside navigation). */
export function guideFor(step: Step | null, from: From, nav: NavState, navPath: Pt[], mPerUnit: number): NavGuide | null {
  return step ? navGuide(from, step.hall, step.booths, nav, navPath, mPerUnit) : null;
}

/**
 * Navigator map screen. Overview: entrance strip on top, map, compact sheet with «Начать маршрут».
 * Navigation mode: only the current instruction on top (+ next step and distance), map, minimal sheet.
 * Sheet: collapsed (one line) → half (route and steps) → expanded (contact, note, visit status); swipe down hides it.
 */
export function MapShell({ step, leg, from, notes, switcher, controls, pills, info, infoLabel, legend, nav, onNav, navPath, navOrigin, mPerUnit, onOpen, onVisited, children }: Props) {
  const [sheet, setSheetRaw] = useState<SheetState>(readSheet);
  const setSheet = (v: SheetState) => {
    setSheetRaw(v);
    saveSheet(v);
  };
  const [modal, setModal] = useState<null | 'legend' | 'info'>(null);
  const drag = useRef<{ y0: number; dy: number } | null>(null);
  const [dragY, setDragY] = useState(0);
  const p = step?.point;
  const g = guideFor(step, from, nav, navPath, mPerUnit);
  const navOn = nav.on && !!g;

  // Distance to the point: walking leg; with no position, from the zone entrance.
  const entranceM = navOrigin === 'entrance' && navPath.length > 1 ? pathLength(navPath) * mPerUnit : 0;
  const dist = legText(leg) || (entranceM ? `≈ ${formatMeters(entranceM)} от входа · ~${Math.max(1, Math.round(entranceM / WALK_M_PER_MIN))} мин` : '');
  const arrived = !!leg?.sameHall;

  const go = (idx: number) => g && onNav({ on: true, idx: Math.max(0, Math.min(idx, g.plan.steps.length - 1)), key: g.key });
  const start = () => {
    if (!g) return;
    onNav({ on: true, idx: 0, key: g.key });
    setSheet('collapsed');
  };
  const stop = () => onNav({ on: false, idx: 0, key: '' });

  const up = () => setSheet(ORDER[Math.min(ORDER.length - 1, ORDER.indexOf(sheet) + 1)]);
  const down = () => setSheet(ORDER[Math.max(0, ORDER.indexOf(sheet) - 1)]);
  // Drag-handle / header: tap toggles, swipe down steps down (to hidden), swipe up steps up.
  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    drag.current = { y0: e.clientY, dy: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current.dy = e.clientY - drag.current.y0;
    setDragY(Math.max(0, drag.current.dy));
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    setDragY(0);
    if (!d) return;
    if (Math.abs(d.dy) < 8) setSheet(sheet === 'expanded' ? 'collapsed' : ORDER[ORDER.indexOf(sheet) + 1]);
    else if (d.dy > 40) down();
    else if (d.dy < -40) up();
  };

  return (
    <div className={`map-screen ${navOn ? 'navigating' : ''}`}>
      {navOn && g ? (
        <div className="nav-banner" role="status" aria-live="polite">
          <div className="nb-main">
            <span className="nb-icon" aria-hidden>
              {NAV_ICON[g.now.kind ?? 'zone']}
            </span>
            <div className="nb-text">
              <div className="nb-now">{g.now.text}</div>
              {g.now.sub && <div className="nb-sub">{g.now.sub}</div>}
            </div>
            {g.nowM !== undefined && <div className="nb-dist">≈ {formatMeters(g.nowM)}</div>}
            <button className="nb-end" onClick={stop} aria-label="Завершить навигацию" title="Завершить навигацию">
              ✕
            </button>
          </div>
          <div className="nb-next">
            <span className="nb-next-t">
              {g.next ? (
                <>
                  Далее: {g.next.text.charAt(0).toLowerCase() + g.next.text.slice(1)}
                  {g.nextM !== undefined && <b> · ≈ {formatMeters(g.nextM)}</b>}
                </>
              ) : (
                'Последний шаг — вы у цели'
              )}
            </span>
            <span className="nb-steps">
              <button onClick={() => go(g.idx - 1)} disabled={g.idx === 0} aria-label="Предыдущий шаг">
                ‹
              </button>
              <span>
                {g.idx + 1}/{g.plan.steps.length}
              </span>
              <button onClick={() => go(g.idx + 1)} disabled={!g.next} aria-label="Следующий шаг">
                ›
              </button>
            </span>
          </div>
        </div>
      ) : (
        g && (
          <button className="nav-strip" onClick={() => setSheet('half')}>
            <span className="ns-text">
              <span aria-hidden>📍</span>{' '}
              {g.plan.entrance ? (
                <>
                  <b>{g.plan.entrance.label}</b> · {g.plan.entrance.street}
                </>
              ) : (
                g.plan.start
              )}
            </span>
            <span className="ns3-more">Шаги ›</span>
          </button>
        )
      )}

      <div className="map-stage">
        {children}
        <div className="float-top">
          {switcher}
          <button className="float-chip" onClick={() => setModal('info')}>
            {infoLabel}
          </button>
        </div>
        {pills && <div className="float-pills">{pills}</div>}
        <div className="float-right">
          {controls.map((c) => (
            <button key={c.key} className={`fab ${c.on ? 'on' : ''}`} onClick={c.onClick} title={c.title} aria-label={c.title}>
              {c.label}
            </button>
          ))}
          <button className="fab" onClick={() => setModal('legend')} title="Обозначения" aria-label="Обозначения">
            ⓘ
          </button>
        </div>

        {step && p && g && sheet === 'hidden' && (
          <button className="bs-restore" onClick={() => setSheet('collapsed')} aria-label="Показать карточку">
            <span aria-hidden>⌃</span> {p.company}
          </button>
        )}
        {step && p && g && sheet !== 'hidden' && (
          <div
            className={`bsheet bs-${sheet} ${dragY ? 'dragging' : ''}`}
            style={dragY ? { transform: `translateY(${dragY}px)` } : undefined}
            aria-label="Следующая точка"
          >
            <div
              className="bs-head"
              role="button"
              tabIndex={0}
              aria-label={sheet === 'expanded' ? 'Свернуть карточку' : 'Развернуть карточку'}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && up()}
            >
              <span className="bs-grip" aria-hidden />
              <div className="bs-row">
                <span className="bs-num" style={{ background: groupColor(p.mapGroup) }} title="Следующая точка">
                  1
                </span>
                <div className="bs-id">
                  <div className="bs-company">
                    {p.company} <span className="bs-loc">· {g.plan.pavilion.replace('Павильон', 'Пав.')}</span>
                  </div>
                  <div className="bs-sub">
                    <b>{g.plan.stand}</b>
                    {dist && <span className="bs-dist"> · {dist}</span>}
                  </div>
                </div>
                {!navOn && (
                  <button className="btn btn-start bs-go" onClick={start}>
                    ▶ Старт
                  </button>
                )}
                {navOn && arrived && (
                  <button className="btn btn-visit-2 bs-go" onClick={() => onVisited(p.id)}>
                    ✓ Посетила
                  </button>
                )}
                <span className="bs-chev" aria-hidden>
                  {sheet === 'expanded' ? '⌄' : '⌃'}
                </span>
              </div>
            </div>
            {(sheet === 'half' || sheet === 'expanded') && (
              <div className="bs-body">
                {sheet === 'expanded' && (
                  <>
                    <div className="bs-tags">
                      <PriorityBadge p={p} /> <GroupTag group={p.mapGroup} />
                    </div>
                    <PointContact p={p} notes={notes} />
                    <button className="btn btn-visit-2 full" onClick={() => onVisited(p.id)}>
                      ✓ Отметить посещённой
                    </button>
                    <button className="btn-link" onClick={() => onOpen(p.id)}>
                      Карточка точки (статусы, заметки) ›
                    </button>
                  </>
                )}
                <div className="bs-route">
                  {g.plan.floor ? `${g.plan.pavilion} · ${g.plan.floor} · стенд ${g.plan.stand}` : `${g.plan.pavilion} · стенд ${g.plan.stand}`}
                  <div className="pnav-route">{g.plan.shortRoute}</div>
                </div>
                {!navOn && (
                  <button className="btn btn-start full" onClick={start}>
                    ▶ Начать маршрут
                  </button>
                )}
                <h3 className="bs-h">Как пройти</h3>
                <RouteSteps steps={g.plan.steps} current={navOn ? g.idx : undefined} onPick={navOn ? go : undefined} />
                {sheet === 'half' && (
                  <button className="pnav-toggle" onClick={() => setSheet('expanded')}>
                    Контакт, примечание, статус ⌃
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {modal && (
        <div className="sheet-backdrop" onClick={() => setModal(null)}>
          <div className={`sheet ${modal === 'info' ? 'sheet-tall' : ''}`} onClick={(e) => e.stopPropagation()} role="dialog">
            <div className="sheet-head">
              <h2>{modal === 'legend' ? 'Обозначения' : 'GPS и данные карты'}</h2>
              <button className="icon-btn" onClick={() => setModal(null)} aria-label="Закрыть">
                ✕
              </button>
            </div>
            {modal === 'legend' && legend}
            {modal === 'info' && info}
          </div>
        </div>
      )}
    </div>
  );
}
