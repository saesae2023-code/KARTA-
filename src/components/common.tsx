import type { Point, PointState } from '../types';
import { boothsInHall, nearestHall } from '../logic';
import { SAME_BOOTH } from '../data';

export function PriorityBadge({ p }: { p: Point }) {
  return <span className={`prio prio-${p.priority}`}>{p.priority}</span>;
}

export function StatusPills({ s }: { s: PointState }) {
  return (
    <span className="pills">
      {s.visit === 'visited' && <span className="pill pill-visited">✓ Посетила</span>}
      {s.visit === 'skipped' && <span className="pill pill-skipped">Пропущено</span>}
      {s.price && <span className="pill pill-price">₽ Цена</span>}
      {s.followUp && <span className="pill pill-follow">Follow-up</span>}
      {s.contact && <span className="pill pill-contact">Контакт</span>}
    </span>
  );
}

/** The big, most visible Hall → Booth block. */
export function HallBooth({ p, current, size = 'xl' }: { p: Point; current: string | null; size?: 'xl' | 'md' }) {
  const hall = nearestHall(p, current);
  const booths = boothsInHall(p, hall);
  const others = p.halls.filter((h) => h !== hall);
  return (
    <div className={`hallbooth hallbooth-${size}`}>
      <div className="hb-hall">
        <span className="hb-label">HALL</span>
        <span className="hb-value">{hall}</span>
      </div>
      <span className="hb-arrow">→</span>
      <div className="hb-booth">
        <span className="hb-label">BOOTH</span>
        {booths.map((b) => (
          <span key={b} className="hb-value">
            {b}
          </span>
        ))}
      </div>
      {others.length > 0 && size === 'xl' && (
        <div className="hb-also">
          Также стенд в Hall {others.join(', ')}: {p.booths.filter((b) => b.hall !== hall).map((b) => b.label).join('; ')}
        </div>
      )}
    </div>
  );
}

export function SameBoothNote({ p }: { p: Point }) {
  const same = SAME_BOOTH.get(p.id);
  if (!same) return null;
  return <div className="note-same">Тот же стенд, что и точка #{same.join(', #')} в Excel — можно закрыть за один подход.</div>;
}

interface ActionsProps {
  p: Point;
  s: PointState;
  onVisited: () => void;
  onSkip: () => void;
  onToggle: (key: 'price' | 'followUp' | 'contact') => void;
  onReset: () => void;
}

export function StatusActions({ s, onVisited, onSkip, onToggle, onReset }: ActionsProps) {
  return (
    <div className="actions">
      <button className={`btn btn-visit ${s.visit === 'visited' ? 'on' : ''}`} onClick={onVisited}>
        ✓ Посетила
      </button>
      <div className="actions-row">
        <button className={`btn btn-tag ${s.price ? 'on on-price' : ''}`} onClick={() => onToggle('price')}>
          ₽ Получить цену
        </button>
        <button className={`btn btn-tag ${s.followUp ? 'on on-follow' : ''}`} onClick={() => onToggle('followUp')}>
          ↻ Follow-up
        </button>
      </div>
      <div className="actions-row">
        <button className={`btn btn-tag ${s.contact ? 'on on-contact' : ''}`} onClick={() => onToggle('contact')}>
          ☎ Контакт получен
        </button>
        <button className={`btn btn-skip ${s.visit === 'skipped' ? 'on' : ''}`} onClick={onSkip}>
          Пропустить
        </button>
      </div>
      {s.visit !== 'pending' && (
        <button className="btn-link" onClick={onReset}>
          Вернуть в «Не посещено»
        </button>
      )}
    </div>
  );
}
