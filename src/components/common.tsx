import type { Point, PointState } from '../types';
import { boothsInHall, nearestHall } from '../logic';
import { SAME_BOOTH } from '../data';
import { groupColor } from '../groups';
import { useState } from 'react';
import { boothLabel, boothsLabel, directions, hallLabel, isOutdoor, navPlan, pathLine, zoneLabel, zoneOf, type From, type NavStep } from '../labels';
import { emails, isUrl, phoneLinks } from '../logic';
import { splitHall } from '../venue';

export function PriorityBadge({ p }: { p: Point }) {
  return <span className={`prio prio-${p.priority}`}>{p.priority}</span>;
}

export function GroupTag({ group, short }: { group: string; short?: boolean }) {
  const c = groupColor(group);
  return (
    <span className="group-tag" style={{ color: c, borderColor: c }}>
      <span className="group-dot" style={{ background: c }} />
      {short ? group.split(' / ')[0] : group}
    </span>
  );
}

export function GroupDot({ group }: { group: string }) {
  return <span className="group-dot" style={{ background: groupColor(group) }} title={group} />;
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

/** The big, most visible block: Pavilion + floor → Stand (technical code small). */
export function HallBooth({ p, current, hall: forced, size = 'xl' }: { p: Point; current: string | null; hall?: string; size?: 'xl' | 'md' }) {
  const hall = forced ?? nearestHall(p, current);
  const booths = boothsInHall(p, hall);
  const others = p.halls.filter((h) => h !== hall);
  const { building, floor } = splitHall(hall);
  const outdoor = isOutdoor(hall);
  return (
    <div className={`hallbooth hallbooth-${size}`} style={{ borderLeft: `8px solid ${groupColor(p.mapGroup)}` }}>
      <div className="hb-hall">
        <span className="hb-label">{outdoor ? 'ОТКРЫТАЯ ПЛОЩАДКА' : 'ПАВИЛЬОН'}</span>
        <span className="hb-value">{building}</span>
        {!outdoor && floor > 0 && <span className="hb-floor">{floor} этаж</span>}
      </div>
      <span className="hb-arrow">→</span>
      <div className="hb-booth">
        <span className="hb-label">СТЕНД</span>
        {booths.map((b) => (
          <span key={b} className="hb-value">
            {boothLabel(b).replace(/-/g, '\u2011')}
          </span>
        ))}
      </div>
      <div className="hb-tech">
        {zoneLabel(zoneOf(hall))} · код: {hall} / {booths.join('; ')}
      </div>
      {others.length > 0 && size === 'xl' && (
        <div className="hb-also">
          Также стенд: {others.map((h) => `${hallLabel(h)} — ${boothsLabel(p.booths.filter((b) => b.hall === h).map((b) => b.label))}`).join('; ')}
        </div>
      )}
    </div>
  );
}

/** "Зона C → Павильон 15 → 2 этаж → стенд D33". */
export function PathLine({ hall, booths }: { hall: string; booths: string[] }) {
  return <div className="path-line">{pathLine(hall, booths)}</div>;
}

/** "Куда идти" — step-by-step directions to the next point. */
export function Directions({ from, hall, booths }: { from: From; hall: string; booths: string[] }) {
  return (
    <section className="directions">
      <h3>Куда идти</h3>
      <ol>
        {directions(from, hall, booths).map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ol>
    </section>
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
      <button className={`btn btn-visit-2 ${s.visit === 'visited' ? 'on' : ''}`} onClick={onVisited}>
        ✓ Отметить посещённой
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

/** Numbered "Как пройти" list: one action per step, optional real landmark. */
export function RouteSteps({ steps, current, onPick }: { steps: NavStep[]; current?: number; onPick?: (i: number) => void }) {
  return (
    <ol className="pnav-steps" aria-label="Как пройти">
      {steps.map((st, i) => (
        <li key={i} className={i === current ? 'cur' : current !== undefined && i < current ? 'done' : ''} onClick={onPick ? () => onPick(i) : undefined}>
          <span className="pnav-n">{i + 1}</span>
          <div>
            <div className="pnav-t">{st.text}</div>
            {st.sub && <div className="pnav-s">{st.sub}</div>}
            {st.landmark && <div className="pnav-l">Ориентир: {st.landmark}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Contact + note of a point (only what exists). */
export function PointContact({ p, notes }: { p: Point; notes?: string }) {
  const phones = phoneLinks(p.phone + ' ' + p.wechatEmail);
  const mails = emails(p.wechatEmail + ' ' + p.phone);
  const raw = [p.phone, p.wechatEmail].filter((x) => x && x !== '—' && !phoneLinks(x).length && !emails(x).length);
  const note = notes?.trim() || p.notes?.trim();
  if (!phones.length && !mails.length && !raw.length && !isUrl(p.website) && !note) return null;
  return (
    <div className="pnav-contact">
      {(phones.length > 0 || mails.length > 0 || raw.length > 0 || isUrl(p.website)) && (
        <div>
          <div className="pnav-h">Контакт</div>
          <div className="pnav-links">
            {phones.map((ph) => (
              <a key={ph.tel} className="chip-btn" href={`tel:${ph.tel}`}>
                ☎ {ph.label}
              </a>
            ))}
            {mails.map((m) => (
              <a key={m} className="chip-btn" href={`mailto:${m}`}>
                ✉ {m}
              </a>
            ))}
            {isUrl(p.website) && (
              <a className="chip-btn" href={p.website} target="_blank" rel="noopener noreferrer">
                🌐 Сайт
              </a>
            )}
          </div>
          {raw.length > 0 && <div className="pnav-s">{raw.join(' · ')}</div>}
        </div>
      )}
      {note && (
        <div>
          <div className="pnav-h">Примечание</div>
          <div className="pnav-note">{note}</div>
        </div>
      )}
    </div>
  );
}

/**
 * Point navigation block: company → pavilion · floor → stand → entrance + street → short route →
 * "Начать маршрут" → "Показать шаги" (collapsed by default) → contact / note.
 */
export function PointNav({ p, hall, booths, from, notes, onStart, startLabel, children }: { p: Point; hall: string; booths: string[]; from: From; notes?: string; onStart?: () => void; startLabel?: string; children?: React.ReactNode }) {
  const plan = navPlan(from, hall, booths);
  const [open, setOpen] = useState(false);
  return (
    <div className="pnav" style={{ borderLeftColor: groupColor(p.mapGroup) }}>
      <div className="pnav-company">{p.company}</div>
      <div className="pnav-place">
        {plan.pavilion}
        {plan.floor ? ` · ${plan.floor}` : ''}
      </div>
      <div className="pnav-stand">Стенд {plan.stand}</div>
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
      {children}
      {onStart && (
        <button className="btn btn-start pnav-cta" onClick={onStart}>
          {startLabel ?? '▶ Начать маршрут'}
        </button>
      )}
      <button className="pnav-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? 'Скрыть шаги ▴' : 'Показать шаги ▾'}
      </button>
      {open && (
        <section className="pnav-how">
          <h3>Как пройти</h3>
          <RouteSteps steps={plan.steps} />
        </section>
      )}
      <PointContact p={p} notes={notes} />
    </div>
  );
}
