import type { Point, PointState } from '../types';
import { HallBooth, PriorityBadge, SameBoothNote, StatusActions } from './common';
import { nearestHall } from '../logic';

interface Props {
  queue: Point[];
  states: Record<number, PointState>;
  current: string | null;
  onPickHall: () => void;
  onOpen: (id: number) => void;
  onVisited: (id: number) => void;
  onSkip: (id: number) => void;
  onToggle: (id: number, key: 'price' | 'followUp' | 'contact') => void;
}

export function NextView({ queue, states, current, onPickHall, onOpen, onVisited, onSkip, onToggle }: Props) {
  const next = queue[0];
  if (!next)
    return (
      <div className="empty">
        <h2>Все точки отработаны 🎉</h2>
        <p className="muted">Не осталось точек со статусом «Не посещено». Проверьте список Follow-up в статистике.</p>
      </div>
    );
  const s = states[next.id];
  const inHall = current && next.halls.includes(current);
  return (
    <div className="next">
      {!current && (
        <button className="banner" onClick={onPickHall}>
          📍 Выберите текущий Hall, чтобы сначала показывать точки рядом
        </button>
      )}
      <div className="next-card">
        <div className="next-top">
          <span className="eyebrow">
            Следующая точка · <PriorityBadge p={next} /> Priority {next.priority}
          </span>
          {current && (
            <span className={`where ${inHall ? 'here' : 'move'}`}>
              {inHall ? 'В этом Hall' : `Переход ${current} → ${nearestHall(next, current)}`}
            </span>
          )}
        </div>
        <HallBooth p={next} current={current} />
        <button className="company-btn" onClick={() => onOpen(next.id)}>
          <span className="company">{next.company}</span>
          <span className="muted">
            #{next.id} · {next.category} · подробнее ›
          </span>
        </button>
        <SameBoothNote p={next} />
        <section className="check-box">
          <h3>Что получить / проверить</h3>
          <p>{next.toCheck}</p>
        </section>
        <StatusActions
          p={next}
          s={s}
          onVisited={() => onVisited(next.id)}
          onSkip={() => onSkip(next.id)}
          onToggle={(k) => onToggle(next.id, k)}
          onReset={() => undefined}
        />
      </div>

      {queue.length > 1 && (
        <div className="upnext">
          <h3>Затем</h3>
          {queue.slice(1, 6).map((p) => (
            <button key={p.id} className="row" onClick={() => onOpen(p.id)}>
              <PriorityBadge p={p} />
              <span className="row-main">
                <span className="row-title">{p.company}</span>
                <span className="muted small">{p.category}</span>
              </span>
              <span className="row-loc">
                <b>{nearestHall(p, current)}</b>
                <span className="small">{p.booths[0]?.label}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
