import { groupColor } from '../groups';
import { transitions, type Plan, type RouteMode } from '../route';
import type { PointState } from '../types';
import { areaOf, splitHall } from '../venue';
import { GroupTag, PriorityBadge } from './common';
import { boothsLabel, hallLabel, hallShort, zoneLabel, zoneOf } from '../labels';
import { RouteModeSwitch } from './RouteModeSwitch';

interface Props {
  plan: Plan;
  states: Record<number, PointState>;
  current: string | null;
  mode: RouteMode;
  onMode: (m: RouteMode) => void;
  onOpen: (id: number) => void;
  onPickHall: () => void;
  onShowMap: (hall: string) => void;
}

export function areaLabel(hall: string): string {
  return areaOf(splitHall(hall).building)?.label.replace('Area', 'Зона') ?? zoneLabel(zoneOf(hall));
}

export function RouteView({ plan, states, current, mode, onMode, onOpen, onPickHall, onShowMap }: Props) {
  const { stops, steps } = plan;
  const first = stops[0];
  const here = first && first.hall === current ? first : undefined;
  const nextStop = here ? stops[1] : first;
  const cur = steps[0];
  const nxt = steps[1];
  let n = 0;

  return (
    <div className="route">
      <RouteModeSwitch mode={mode} onChange={onMode} />

      <div className="route-now">
        <button className="rn-cell rn-hall" onClick={onPickHall}>
          <span className="rn-label">Где вы</span>
          <span className="rn-big">{current ? hallShort(current) : '—'}</span>
          <span className="rn-sub">{current ? `${here ? here.points.length : 0} ост. здесь` : 'выбрать'}</span>
        </button>
        <button className="rn-cell" onClick={() => nextStop && onShowMap(nextStop.hall)} disabled={!nextStop}>
          <span className="rn-label">Следующий павильон</span>
          <span className="rn-big">{nextStop ? hallShort(nextStop.hall) : '—'}</span>
          <span className="rn-sub">{nextStop ? `${nextStop.points.length} точ. · ${areaLabel(nextStop.hall)}` : 'нет'}</span>
        </button>
        {cur && (
          <button className="rn-cell rn-wide" style={{ borderLeftColor: groupColor(cur.point.mapGroup) }} onClick={() => onOpen(cur.point.id)}>
            <span className="rn-label">Текущая точка</span>
            <span className="rn-point">
              <b>{hallLabel(cur.hall)} · стенд {boothsLabel(cur.booths)}</b> {cur.point.company}
            </span>
          </button>
        )}
        {nxt && (
          <button className="rn-cell rn-wide" style={{ borderLeftColor: groupColor(nxt.point.mapGroup) }} onClick={() => onOpen(nxt.point.id)}>
            <span className="rn-label">Следующая точка</span>
            <span className="rn-point">
              <b>{hallLabel(nxt.hall)} · стенд {boothsLabel(nxt.booths)}</b> {nxt.point.company}
            </span>
          </button>
        )}
      </div>

      <div className="route-summary">
        <b>{steps.length}</b> точек · <b>{stops.length}</b> остановок (павильон/этаж) · <b>{transitions(stops, current)}</b> переходов
        <p className="muted small">
          Сначала закрываем текущий павильон, затем идём в ближайший по схеме комплекса. Внутри павильона — по порядку стендов.
          Координат стендов нет — точки привязаны к павильонам.
        </p>
      </div>

      {stops.length === 0 && <div className="empty">Нет точек для маршрута.</div>}

      <ol className="chain">
        {stops.map((stop, i) => (
          <li key={stop.hall + stop.segment + i} className={`chain-stop ${stop.hall === current ? 'is-current' : ''} ${stop === nextStop ? 'is-next' : ''}`}>
            <div className="chain-head">
              <span className="chain-num">{i + 1}</span>
              <span className="chain-hall">{hallLabel(stop.hall)}</span>
              <span className="muted small">
                {areaLabel(stop.hall)} · {stop.points.length} точ.
                {stop.segment === 'B' && ' · этап B'}
                {stop.hall === current && ' · вы здесь'}
              </span>
              <button className="map-btn" onClick={() => onShowMap(stop.hall)} aria-label={`${hallLabel(stop.hall)} на карте`}>
                🗺
              </button>
            </div>
            {stop.points.map((p) => {
              n++;
              const booths = p.booths.filter((b) => b.hall === stop.hall).map((b) => b.label);
              return (
                <button key={p.id} className="row chain-row" style={{ borderLeftColor: groupColor(p.mapGroup) }} onClick={() => onOpen(p.id)}>
                  <span className="step-num">{n}</span>
                  <span className="row-main">
                    <span className="row-title">
                      <PriorityBadge p={p} /> {p.company}
                    </span>
                    <GroupTag group={p.mapGroup} short />
                  </span>
                  <span className="row-loc">
                    <b>стенд {boothsLabel(booths.length ? booths : [p.booth])}</b>
                    {states[p.id].followUp && <span className="small">↻</span>}
                  </span>
                </button>
              );
            })}
            {i < stops.length - 1 && (
              <div className="chain-arrow">
                ↓ {stops[i + 1].hall === stop.hall ? 'этап B, тот же павильон' : stops[i + 1].hall.split('.')[0] === stop.hall.split('.')[0] ? `на ${stops[i + 1].hall.split('.')[1]} этаж` : `в ${hallLabel(stops[i + 1].hall).replace('Павильон', 'павильон')}`}
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
