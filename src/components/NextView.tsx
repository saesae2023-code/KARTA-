import type { Plan, RouteMode } from '../route';
import type { PointState } from '../types';
import { GroupTag, HallBooth, PriorityBadge, SameBoothNote, StatusActions } from './common';
import { RouteModeSwitch } from './RouteModeSwitch';

interface Props {
  plan: Plan;
  states: Record<number, PointState>;
  current: string | null;
  mode: RouteMode;
  onMode: (m: RouteMode) => void;
  onPickHall: () => void;
  onOpen: (id: number) => void;
  onShowMap: (hall: string) => void;
  onVisited: (id: number) => void;
  onSkip: (id: number) => void;
  onToggle: (id: number, key: 'price' | 'followUp' | 'contact') => void;
}

export function NextView({ plan, states, current, mode, onMode, onPickHall, onOpen, onShowMap, onVisited, onSkip, onToggle }: Props) {
  const step = plan.steps[0];
  if (!step)
    return (
      <div className="next">
        <RouteModeSwitch mode={mode} onChange={onMode} />
        <div className="empty">
          <h2>Все точки отработаны 🎉</h2>
          <p className="muted">В этом режиме не осталось точек «Не посещено». Проверьте Follow-up в статистике.</p>
        </div>
      </div>
    );
  const next = step.point;
  const s = states[next.id];
  const inHall = current === step.hall;
  const leftHere = plan.stops[0].points.length;
  return (
    <div className="next">
      {!current && (
        <button className="banner" onClick={onPickHall}>
          📍 Выберите текущий Hall — маршрут начнётся от него
        </button>
      )}
      <RouteModeSwitch mode={mode} onChange={onMode} />
      <div className="next-card">
        <div className="next-top">
          <span className="eyebrow">
            Следующая точка · <PriorityBadge p={next} /> Priority {next.priority}
          </span>
          {current && (
            <span className={`where ${inHall ? 'here' : 'move'}`}>
              {inHall ? `В этом Hall · ещё ${leftHere}` : `Переход ${current} → ${step.hall}`}
            </span>
          )}
        </div>
        <HallBooth p={next} current={current} hall={step.hall} />
        <button className="company-btn" onClick={() => onOpen(next.id)}>
          <span className="company">{next.company}</span>
          <span className="muted">
            #{next.id} · {next.category} · подробнее ›
          </span>
        </button>
        <div className="tag-row">
          <GroupTag group={next.mapGroup} />
          <button className="btn-link" onClick={() => onShowMap(step.hall)}>
            🗺 Показать на карте
          </button>
        </div>
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

      {plan.steps.length > 1 && (
        <div className="upnext">
          <h3>Затем по маршруту</h3>
          {plan.steps.slice(1, 6).map((st) => (
            <button key={st.point.id} className="row" onClick={() => onOpen(st.point.id)}>
              <PriorityBadge p={st.point} />
              <span className="row-main">
                <span className="row-title">{st.point.company}</span>
                <GroupTag group={st.point.mapGroup} short />
              </span>
              <span className="row-loc">
                <b className={st.hall !== step.hall ? 'hall-change' : ''}>{st.hall}</b>
                <span className="small">{st.booths[0]}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
