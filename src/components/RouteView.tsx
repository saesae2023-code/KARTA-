import { useMemo, useState } from 'react';
import { POINTS } from '../data';
import { boothsInHall, buildRoute } from '../logic';
import type { PointState } from '../types';
import { PriorityBadge, StatusPills } from './common';

interface Props {
  states: Record<number, PointState>;
  current: string | null;
  onOpen: (id: number) => void;
  onPickHall: () => void;
}

export function RouteView({ states, current, onOpen, onPickHall }: Props) {
  const [onlyA, setOnlyA] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const route = useMemo(() => {
    const pts = POINTS.filter(
      (p) => (showDone || states[p.id].visit === 'pending') && (!onlyA || p.priority === 'A'),
    );
    return buildRoute(pts, current);
  }, [states, current, onlyA, showDone]);

  const stops = route.filter((r) => r.primary.size > 0);

  return (
    <div className="route">
      <div className="route-head">
        <p className="muted small">
          Точки сгруппированы по Hall. Порядок павильонов — от текущего Hall к ближайшему по номеру (координат стендов в
          базе нет, поэтому порядок Booth внутри Hall — A→B, затем по номеру стенда).
        </p>
        <div className="toggles">
          <button className={`toggle ${onlyA ? 'on' : ''}`} onClick={() => setOnlyA(!onlyA)}>
            Только A
          </button>
          <button className={`toggle ${showDone ? 'on' : ''}`} onClick={() => setShowDone(!showDone)}>
            Показать отработанные
          </button>
          <button className="toggle" onClick={onPickHall}>
            Старт: {current ?? 'выбрать Hall'}
          </button>
        </div>
        <div className="route-summary">
          <b>{stops.length}</b> павильонов · <b>{stops.reduce((n, r) => n + r.primary.size, 0)}</b> точек ·{' '}
          <b>{Math.max(0, stops.length - (current && stops[0]?.hall === current ? 1 : 0))}</b> переходов
        </div>
      </div>

      {route.length === 0 && <div className="empty">Нет точек для маршрута.</div>}

      <ol className="stops">
        {route.map((stop) => {
          const isPrimaryEmpty = stop.primary.size === 0;
          return (
            <li key={stop.hall} className={`stop ${stop.hall === current ? 'stop-current' : ''} ${isPrimaryEmpty ? 'stop-secondary' : ''}`}>
              <div className="stop-head">
                <span className="stop-hall">Hall {stop.hall}</span>
                <span className="muted small">
                  {stop.primary.size} точ.
                  {stop.points.length > stop.primary.size && ` + ${stop.points.length - stop.primary.size} доп. стенд`}
                  {stop.hall === current && ' · вы здесь'}
                </span>
              </div>
              {stop.points.map((p) => (
                <button
                  key={p.id}
                  className={`row ${stop.primary.has(p.id) ? '' : 'row-extra'} ${states[p.id].visit !== 'pending' ? 'row-done' : ''}`}
                  onClick={() => onOpen(p.id)}
                >
                  <PriorityBadge p={p} />
                  <span className="row-main">
                    <span className="row-title">{p.company}</span>
                    <span className="muted small">
                      {stop.primary.has(p.id) ? p.category : `доп. стенд · основной визит в Hall ${route.find((r) => r.primary.has(p.id))?.hall}`}
                    </span>
                    <StatusPills s={states[p.id]} />
                  </span>
                  <span className="row-loc">
                    <b>{boothsInHall(p, stop.hall).join(' ')}</b>
                  </span>
                </button>
              ))}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
