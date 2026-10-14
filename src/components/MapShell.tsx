import { useState, type ReactNode } from 'react';
import { groupColor } from '../groups';
import { boothsLabel, compactDirections, hallLabel, zoneLabel, zoneOf, type From } from '../labels';
import { emails, phoneLinks } from '../logic';
import type { Step } from '../route';
import { Directions, GroupTag, PriorityBadge } from './common';
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

const legText = (leg: LegInfo | null) =>
  !leg ? '' : leg.sameHall ? 'вы в этом павильоне' : leg.known ? `${leg.approx ? '≈ ' : ''}${formatMeters(leg.meters)} · ~${leg.minutes} мин` : '';

/** Navigator-style map screen: compact strip on top, full-height map, compact bottom sheet. */
export function MapShell({ step, leg, from, notes, switcher, controls, pills, info, infoLabel, legend, follow, onToggleFollow, onOpen, onVisited, children }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [modal, setModal] = useState<null | 'directions' | 'legend' | 'info'>(null);
  const dist = legText(leg);
  const p = step?.point;

  return (
    <div className="map-screen">
      {step && p && (
        <div className="nav-strip" style={{ borderLeftColor: groupColor(p.mapGroup) }}>
          <div className="ns1">
            {hallLabel(step.hall)} · стенд {boothsLabel(step.booths)}
          </div>
          <div className="ns2">
            <span>
              {zoneLabel(zoneOf(step.hall))} · {p.company}
            </span>
            {dist && <b>{dist}</b>}
          </div>
          <button className="ns3" onClick={() => setModal('directions')}>
            <span className="ns3-text">{compactDirections(from, step.hall, step.booths)}</span>
            <span className="ns3-more">Подробнее</span>
          </button>
        </div>
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

        {step && p && (
          <div className={`bsheet ${expanded ? 'open' : ''}`}>
            <button className="bs-handle" onClick={() => setExpanded(!expanded)} aria-label={expanded ? 'Свернуть' : 'Развернуть'}>
              <span />
            </button>
            <div className="bs-top" aria-label="Следующая точка">
              <span className="bs-num" style={{ background: groupColor(p.mapGroup) }} title="Следующая точка">
                1
              </span>
              <button className="bs-company" onClick={() => onOpen(p.id)}>
                {p.company}
              </button>
              <PriorityBadge p={p} />
            </div>
            <div className="bs-where">
              <b>{hallLabel(step.hall)}</b>
              {dist && <span className="bs-dist">{dist}</span>}
            </div>
            <div className="bs-booth">Стенд {boothsLabel(step.booths)}</div>
            <div className="bs-btns">
              <button className={`btn ${follow ? 'btn-secondary' : 'btn-start'}`} onClick={onToggleFollow}>
                {follow ? '■ Стоп' : '▶ Начать маршрут'}
              </button>
              <button className="btn btn-visit" onClick={() => onVisited(p.id)}>
                ✓ Посетила
              </button>
            </div>
            {expanded && (
              <div className="bs-more">
                <GroupTag group={p.mapGroup} />
                <section className="check-box">
                  <h3>Что получить / проверить</h3>
                  <p>{p.toCheck}</p>
                </section>
                <div className="bs-contacts">
                  {phoneLinks(p.phone + ' ' + p.wechatEmail).map((ph) => (
                    <a key={ph.tel} className="chip-btn" href={`tel:${ph.tel}`}>
                      ☎ {ph.label}
                    </a>
                  ))}
                  {emails(p.wechatEmail + ' ' + p.phone).map((m) => (
                    <a key={m} className="chip-btn" href={`mailto:${m}`}>
                      ✉ {m}
                    </a>
                  ))}
                  {/^https?:\/\//.test(p.website) && (
                    <a className="chip-btn" href={p.website} target="_blank" rel="noopener noreferrer">
                      🌐 Сайт
                    </a>
                  )}
                </div>
                {notes && <p className="muted small">Заметки: {notes}</p>}
                <button className="btn btn-secondary full" onClick={() => onOpen(p.id)}>
                  Открыть карточку (статусы, заметки)
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {modal && (
        <div className="sheet-backdrop" onClick={() => setModal(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog">
            <div className="sheet-head">
              <h2>{modal === 'directions' ? 'Куда идти' : modal === 'legend' ? 'Обозначения' : 'GPS и данные карты'}</h2>
              <button className="icon-btn" onClick={() => setModal(null)} aria-label="Закрыть">
                ✕
              </button>
            </div>
            {modal === 'directions' && step && <Directions from={from} hall={step.hall} booths={step.booths} />}
            {modal === 'legend' && legend}
            {modal === 'info' && info}
          </div>
        </div>
      )}
    </div>
  );
}
