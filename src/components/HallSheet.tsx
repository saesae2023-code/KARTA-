import type { Plan } from '../route';
import type { PointState } from '../types';
import { GroupTag, PriorityBadge, StatusPills } from './common';
import { pointsInHall } from './MapView';
import { areaLabel } from './RouteView';
import { priorityRank } from '../logic';

interface Props {
  hall: string;
  plan: Plan;
  states: Record<number, PointState>;
  current: string | null;
  onClose: () => void;
  onOpen: (id: number) => void;
  onSetCurrent: (hall: string) => void;
  /** Record the current GPS fix as this hall's real coordinate. */
  onMark?: (hall: string) => void;
}

export function HallSheet({ hall, plan, states, current, onClose, onOpen, onSetCurrent, onMark }: Props) {
  const pts = pointsInHall(hall).sort(
    (a, b) => Number(states[a.id].visit !== 'pending') - Number(states[b.id].visit !== 'pending') || priorityRank(a) - priorityRank(b) || a.id - b.id,
  );
  const stopNo = plan.stops.findIndex((s) => s.hall === hall);
  const left = pts.filter((p) => states[p.id].visit === 'pending').length;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Hall ${hall}`}>
        <div className="sheet-head">
          <div>
            <div className="eyebrow">
              {areaLabel(hall)}
              {stopNo >= 0 && ` · шаг маршрута ${stopNo + 1}`}
            </div>
            <h2 className="sheet-hall">Hall {hall}</h2>
            <div className="muted">
              {left} осталось из {pts.length}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>
        {current !== hall && (
          <button className="btn btn-secondary full" onClick={() => onSetCurrent(hall)}>
            Я в этом Hall
          </button>
        )}
        {onMark && (
          <button className="btn btn-mark full" onClick={() => onMark(hall)}>
            📍 Отметить: я здесь — сохранить GPS как координату Hall {hall}
          </button>
        )}
        <div className="sheet-list">
          {pts.map((p) => {
            const booths = p.booths.filter((b) => b.hall === hall).map((b) => b.label);
            return (
              <button key={p.id} className={`row ${states[p.id].visit !== 'pending' ? 'row-done' : ''}`} onClick={() => onOpen(p.id)}>
                <PriorityBadge p={p} />
                <span className="row-main">
                  <span className="row-title">{p.company}</span>
                  <GroupTag group={p.mapGroup} short />
                  <StatusPills s={states[p.id]} />
                </span>
                <span className="row-loc">
                  <b>{(booths.length ? booths : [p.booth]).join(' ')}</b>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
