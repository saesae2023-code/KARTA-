import type { Plan, RouteMode } from '../route';
import type { LegInfo } from './MapView';
import { LegLine, SuggestBanner } from './LegInfo';
import type { PointState } from '../types';
import { GroupTag, PointNav, PriorityBadge, SameBoothNote, StatusActions } from './common';
import { buildingLabel, boothLabel, hallShort, type From } from '../labels';
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
  leg: LegInfo | null;
  suggest: { savingM: number } | null;
  onReplan: () => void;
  /** Where the user is now, for the step-by-step directions. */
  from: From;
}

export function NextView({ plan, states, current, mode, onMode, onPickHall, onOpen, onShowMap, onVisited, onSkip, onToggle, leg, suggest, onReplan, from }: Props) {
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
          📍 Нажмите «Я в павильоне» — маршрут начнётся от него
        </button>
      )}
      <RouteModeSwitch mode={mode} onChange={onMode} />
      {suggest && <SuggestBanner savingM={suggest.savingM} onReplan={onReplan} />}
      <div className="next-card">
        <div className="next-top">
          <span className="eyebrow">
            Следующая точка · <PriorityBadge p={next} /> приоритет {next.priority}
          </span>
          {current && (
            <span className={`where ${inHall ? 'here' : 'move'}`}>
              {inHall ? `Вы в этом павильоне · ещё ${leftHere}` : `Переход: ${buildingLabel(current).toLowerCase()} → ${buildingLabel(step.hall).toLowerCase()}`}
            </span>
          )}
        </div>
        <PointNav p={next} hall={step.hall} booths={step.booths} from={from} notes={s?.notes} onStart={() => onShowMap(step.hall)}>
          {leg && <LegLine leg={leg} />}
          <SameBoothNote p={next} />
        </PointNav>
        <StatusActions
          p={next}
          s={s}
          onVisited={() => onVisited(next.id)}
          onSkip={() => onSkip(next.id)}
          onToggle={(k) => onToggle(next.id, k)}
          onReset={() => undefined}
        />
        <div className="tag-row">
          <GroupTag group={next.mapGroup} />
          <button className="btn-link" onClick={() => onOpen(next.id)}>
            Карточка точки ›
          </button>
        </div>
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
                <b className={st.hall !== step.hall ? 'hall-change' : ''}>{hallShort(st.hall)}</b>
                <span className="small">стенд {boothLabel(st.booths[0] ?? '')}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
