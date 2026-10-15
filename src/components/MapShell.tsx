import { useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { groupColor } from '../groups';
import { navPlan, type From } from '../labels';
import type { Step } from '../route';
import { PriorityBadge, RouteSteps } from './common';
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
  follow: boolean;
  onToggleFollow: () => void;
  onOpen: (id: number) => void;
  onVisited: (id: number) => void;
  /** The map itself; fills the stage. */
  children: ReactNode;
}

const SHEET_KEY = 'altiora-map-sheet';
function readSheet(): boolean {
  try {
    return localStorage.getItem(SHEET_KEY) === 'open';
  } catch {
    return false;
  }
}

const legText = (leg: LegInfo | null) =>
  !leg ? '' : leg.sameHall ? 'вы в этом павильоне' : leg.known ? `${leg.approx ? '≈ ' : ''}${formatMeters(leg.meters)} · ~${leg.minutes} мин` : '';

/** Navigator-style map screen: compact strip on top, full-height map, compact bottom sheet. */
export function MapShell({ step, leg, from, switcher, controls, pills, info, infoLabel, legend, follow, onToggleFollow, onOpen, onVisited, children }: Props) {
  const [expanded, setExpandedRaw] = useState(readSheet);
  const setExpanded = (v: boolean) => {
    setExpandedRaw(v);
    try {
      localStorage.setItem(SHEET_KEY, v ? 'open' : 'closed');
    } catch {
      /* storage unavailable: state just isn't remembered */
    }
  };
  const [modal, setModal] = useState<null | 'directions' | 'legend' | 'info'>(null);
  const drag = useRef<{ y0: number; dy: number } | null>(null);
  const [dragY, setDragY] = useState(0);
  const dist = legText(leg);
  const p = step?.point;
  const plan = step ? navPlan(from, step.hall, step.booths) : null;
  const cur = plan?.steps[0];

  // Drag-handle / header: tap toggles, swipe down collapses, swipe up expands.
  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
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
    if (Math.abs(d.dy) < 8) setExpanded(!expanded);
    else if (d.dy > 40) setExpanded(false);
    else if (d.dy < -40) setExpanded(true);
  };

  return (
    <div className="map-screen">
      {plan && (
        <button className="nav-strip" onClick={() => setModal('directions')}>
          <span className="ns-text">
            <span aria-hidden>📍</span>{' '}
            {plan.entrance ? (
              <>
                <b>{plan.entrance.label}</b> · {plan.entrance.street}
              </>
            ) : (
              plan.start
            )}
          </span>
          <span className="ns3-more">Шаги ›</span>
        </button>
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

        {step && p && plan && (
          <div
            className={`bsheet ${expanded ? 'open' : ''} ${dragY ? 'dragging' : ''}`}
            style={dragY ? { transform: `translateY(${dragY}px)` } : undefined}
            aria-label="Следующая точка"
          >
            <div
              className="bs-head"
              role="button"
              tabIndex={0}
              aria-expanded={expanded}
              aria-label={expanded ? 'Свернуть карточку' : 'Развернуть карточку'}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setExpanded(!expanded)}
            >
              <span className="bs-grip" aria-hidden />
              <div className="bs-row">
                <span className="bs-num" style={{ background: groupColor(p.mapGroup) }} title="Следующая точка">
                  1
                </span>
                <span className="bs-company">{p.company}</span>
                {dist && <span className="bs-dist">{dist}</span>}
                <span className="bs-chev" aria-hidden>
                  {expanded ? '▾' : '▴'}
                </span>
              </div>
              <div className="bs-place">
                {plan.pavilion}
                {plan.floor ? ` · ${plan.floor}` : ''} · стенд {plan.stand}
              </div>
            </div>
            {expanded && (
              <div className="bs-body">
                {cur && (
                  <div className="bs-step">
                    <div className="bs-step-k">
                      Шаг 1 из {plan.steps.length}
                    </div>
                    <div className="bs-step-t">{cur.text}</div>
                    {cur.sub && <div className="pnav-s">{cur.sub}</div>}
                    {cur.landmark && <div className="pnav-l">Ориентир: {cur.landmark}</div>}
                  </div>
                )}
                <button className={`btn ${follow ? 'btn-secondary' : 'btn-start'} full`} onClick={onToggleFollow}>
                  {follow ? '■ Остановить маршрут' : '▶ Начать маршрут'}
                </button>
                <button className="pnav-toggle" onClick={() => setModal('directions')}>
                  Показать шаги
                </button>
                <button className="btn btn-visit-2 full" onClick={() => onVisited(p.id)}>
                  ✓ Отметить посещённой
                </button>
                <div className="bs-foot">
                  <PriorityBadge p={p} />
                  <button className="btn-link" onClick={() => onOpen(p.id)}>
                    Карточка точки ›
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {modal && (
        <div className="sheet-backdrop" onClick={() => setModal(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog">
            <div className="sheet-head">
              <h2>{modal === 'directions' ? 'Как пройти' : modal === 'legend' ? 'Обозначения' : 'GPS и данные карты'}</h2>
              <button className="icon-btn" onClick={() => setModal(null)} aria-label="Закрыть">
                ✕
              </button>
            </div>
            {modal === 'directions' && step && <NavModal from={from} hall={step.hall} booths={step.booths} />}
            {modal === 'legend' && legend}
            {modal === 'info' && info}
          </div>
        </div>
      )}
    </div>
  );
}

function NavModal({ from, hall, booths }: { from: From; hall: string; booths: string[] }) {
  const plan = navPlan(from, hall, booths);
  return (
    <div className="pnav-modal">
      {plan.entrance ? (
        <div className="pnav-entry">
          <span aria-hidden>📍</span> <b>{plan.entrance.label}</b> · со стороны {plan.entrance.street}
        </div>
      ) : (
        plan.start && (
          <div className="pnav-entry">
            <span aria-hidden>📍</span> {plan.start}
          </div>
        )
      )}
      <div className="pnav-route">{plan.shortRoute}</div>
      <RouteSteps steps={plan.steps} />
    </div>
  );
}
