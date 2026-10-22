import { useState } from 'react';
import { DATASETS, KNOWN_PHASES, PHASE, switchPhase } from '../phase';

/** "Canton Fair Map · Фаза N ▾" in the header; opens the phase picker. */
export function PhaseSwitch() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="sub phase-btn" onClick={() => setOpen(true)} aria-label={`Фаза ${PHASE}. Сменить фазу`}>
        Canton Fair Map · <b>Фаза {PHASE}</b> ▾
      </button>
      {open && (
        <div className="sheet-backdrop" onClick={() => setOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Фаза выставки">
            <div className="sheet-head">
              <h2>Фаза выставки</h2>
              <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Закрыть">
                ✕
              </button>
            </div>
            <div className="phase-list">
              {KNOWN_PHASES.map((n) => {
                const d = DATASETS.get(n);
                return (
                  <button key={n} className={`phase-row ${n === PHASE ? 'on' : ''}`} disabled={!d} onClick={() => (n === PHASE ? setOpen(false) : switchPhase(n))}>
                    <b>Фаза {n}</b>
                    <span className="small">{d ? `${d.dates ? `${d.dates} · ` : ''}${d.points.length} точек · ${d.source}` : 'нет данных — Excel этой фазы ещё не загружен'}</span>
                    {n === PHASE && <span className="phase-cur">открыта</span>}
                  </button>
                );
              })}
            </div>
            <p className="muted small">Статусы посещения, маршрут и навигация у каждой фазы свои. Отметки павильонов «📍 я здесь» общие — комплекс тот же.</p>
          </div>
        </div>
      )}
    </>
  );
}
