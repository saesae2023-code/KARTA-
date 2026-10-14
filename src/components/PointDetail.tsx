import { COLUMNS } from '../data';
import { emails, isUrl, phoneLinks, wechatId } from '../logic';
import type { Point, PointState } from '../types';
import { HallBooth, PriorityBadge, SameBoothNote, StatusActions } from './common';

interface Props {
  p: Point;
  s: PointState;
  current: string | null;
  onClose: () => void;
  onVisited: () => void;
  onSkip: () => void;
  onToggle: (key: 'price' | 'followUp' | 'contact') => void;
  onReset: () => void;
  onNotes: (notes: string) => void;
}

function Linkish({ text }: { text: string }) {
  if (isUrl(text))
    return (
      <a href={text} target="_blank" rel="noopener noreferrer" className="url">
        {text}
      </a>
    );
  return <>{text || '—'}</>;
}

export function Contacts({ p }: { p: Point }) {
  const phones = phoneLinks(p.phone + ' ' + p.wechatEmail);
  const mails = emails(p.wechatEmail + ' ' + p.phone);
  const wx = wechatId(p.wechatEmail);
  const whatsapp = /whatsapp/i.test(p.phone);
  return (
    <div className="contacts">
      <dl>
        <dt>Телефон / WhatsApp</dt>
        <dd>{p.phone || '—'}</dd>
        <dt>WeChat / Email</dt>
        <dd>{p.wechatEmail || '—'}</dd>
        <dt>Сайт</dt>
        <dd>
          <Linkish text={p.website} />
        </dd>
      </dl>
      <div className="contact-btns">
        {phones.map((ph) => (
          <a key={'t' + ph.tel} className="chip-btn" href={`tel:${ph.tel}`}>
            ☎ {ph.label}
          </a>
        ))}
        {whatsapp &&
          phones
            .filter((ph) => ph.wa)
            .map((ph) => (
              <a key={'w' + ph.tel} className="chip-btn chip-wa" href={`https://wa.me/${ph.wa}`} target="_blank" rel="noopener noreferrer">
                WhatsApp
              </a>
            ))}
        {mails.map((m) => (
          <a key={m} className="chip-btn" href={`mailto:${m}`}>
            ✉ {m}
          </a>
        ))}
        {wx && (
          <button className="chip-btn" onClick={() => navigator.clipboard?.writeText(wx)}>
            WeChat: {wx} (копировать)
          </button>
        )}
        {isUrl(p.website) && (
          <a className="chip-btn" href={p.website} target="_blank" rel="noopener noreferrer">
            🌐 Сайт
          </a>
        )}
      </div>
    </div>
  );
}

export function PointDetail({ p, s, current, onClose, onVisited, onSkip, onToggle, onReset, onNotes }: Props) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet sheet-tall" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={p.company}>
        <div className="sheet-head">
          <div>
            <div className="eyebrow">
              <PriorityBadge p={p} /> #{p.id} · {p.mapGroup}
            </div>
            <h2>{p.company}</h2>
            <div className="muted">{p.category}</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>

        <HallBooth p={p} current={current} />
        <SameBoothNote p={p} />

        <section className="check-box">
          <h3>Что получить / проверить</h3>
          <p>{p.toCheck}</p>
        </section>

        <StatusActions p={p} s={s} onVisited={onVisited} onSkip={onSkip} onToggle={onToggle} onReset={onReset} />

        <label className="notes">
          <span>Итог / заметки</span>
          <textarea value={s.notes} rows={3} placeholder="Цена, MOQ, имя менеджера…" onChange={(e) => onNotes(e.target.value)} />
        </label>

        <section>
          <h3>Что представлено</h3>
          <p>{p.products}</p>
        </section>
        <section>
          <h3>Почему точка релевантна</h3>
          <p>{p.why}</p>
        </section>
        <section>
          <h3>Контакты</h3>
          <Contacts p={p} />
        </section>
        <section>
          <h3>Верификация</h3>
          <p>{p.verification}</p>
          <p className="small">
            Источник: <Linkish text={p.source} />
          </p>
        </section>

        <details className="raw">
          <summary>Все поля Excel (FULL MASTER LIST)</summary>
          <dl>
            {COLUMNS.map((c) => (
              <div key={c}>
                <dt>{c}</dt>
                <dd>
                  <Linkish text={p.raw[c] ?? ''} />
                </dd>
              </div>
            ))}
          </dl>
        </details>
      </div>
    </div>
  );
}
