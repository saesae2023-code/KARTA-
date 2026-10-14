import { useState } from 'react';
import { ALL_HALLS, POINTS } from '../data';
import type { PointState } from '../types';

interface Props {
  current: string | null;
  states: Record<number, PointState>;
  onSelect: (hall: string | null) => void;
  onClose: () => void;
}

type GpsState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; lat: number; lon: number; acc: number }
  | { kind: 'error'; msg: string };

export function HallSelector({ current, states, onSelect, onClose }: Props) {
  const [gps, setGps] = useState<GpsState>({ kind: 'idle' });
  const [custom, setCustom] = useState('');

  const requestGps = () => {
    if (!('geolocation' in navigator)) {
      setGps({ kind: 'error', msg: 'GPS недоступен в этом браузере.' });
      return;
    }
    setGps({ kind: 'loading' });
    navigator.geolocation.getCurrentPosition(
      (pos) => setGps({ kind: 'ok', lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy }),
      (err) => setGps({ kind: 'error', msg: err.code === err.PERMISSION_DENIED ? 'Доступ к GPS запрещён.' : 'Не удалось получить позицию.' }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  };

  const left = (hall: string) =>
    POINTS.filter((p) => p.halls.includes(hall) && states[p.id].visit === 'pending');

  const customValid = /^\d{1,2}\.\d$/.test(custom.trim());

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Выбор Hall">
        <div className="sheet-head">
          <h2>Где вы сейчас?</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>

        <div className="gps-box">
          <button className="btn btn-secondary" onClick={requestGps} disabled={gps.kind === 'loading'}>
            📍 {gps.kind === 'loading' ? 'Определяю…' : 'Разрешить GPS'}
          </button>
          {gps.kind === 'ok' && (
            <p className="muted small">
              GPS: {gps.lat.toFixed(5)}, {gps.lon.toFixed(5)} (±{Math.round(gps.acc)} м). Внутри павильонов GPS не даёт
              точную indoor-позицию, а координат Hall/Booth в базе нет — выберите Hall вручную ниже.
            </p>
          )}
          {gps.kind === 'error' && <p className="muted small">{gps.msg} Выберите Hall вручную.</p>}
          {gps.kind === 'idle' && (
            <p className="muted small">GPS работает только как подсказка: Hall определяется ручным выбором.</p>
          )}
        </div>

        <div className="hall-grid">
          {ALL_HALLS.map((h) => {
            const n = left(h);
            const a = n.filter((p) => p.priority === 'A').length;
            return (
              <button
                key={h}
                className={`hall-btn ${current === h ? 'active' : ''} ${n.length === 0 ? 'done' : ''}`}
                onClick={() => {
                  onSelect(h);
                  onClose();
                }}
              >
                <span className="hall-num">{h}</span>
                <span className="hall-meta">{n.length ? `${n.length} ост.${a ? ` · A${a}` : ''}` : 'готово'}</span>
              </button>
            );
          })}
        </div>

        <form
          className="custom-hall"
          onSubmit={(e) => {
            e.preventDefault();
            if (customValid) {
              onSelect(custom.trim());
              onClose();
            }
          }}
        >
          <input
            inputMode="decimal"
            placeholder="Другой Hall, напр. 12.1"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
          <button className="btn btn-secondary" disabled={!customValid}>
            OK
          </button>
        </form>
        {current && (
          <button
            className="btn-link"
            onClick={() => {
              onSelect(null);
              onClose();
            }}
          >
            Сбросить текущий Hall
          </button>
        )}
      </div>
    </div>
  );
}
