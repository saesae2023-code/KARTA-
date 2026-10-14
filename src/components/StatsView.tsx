import { useRef } from 'react';
import { ALL_GROUPS, COLUMNS, POINTS } from '../data';
import { toCsv } from '../logic';
import { computeStats } from '../stats';
import type { Persisted } from '../store';
import type { PointState } from '../types';
import { PriorityBadge } from './common';

interface Props {
  states: Record<number, PointState>;
  snapshot: Persisted;
  onOpen: (id: number) => void;
  onImport: (data: Persisted) => void;
  onReset: () => void;
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function StatsView({ states, snapshot, onOpen, onImport, onReset }: Props) {
  const st = computeStats(states);
  const file = useRef<HTMLInputElement>(null);
  const tiles = [
    { label: 'Всего точек', value: st.total },
    { label: 'Посещено', value: st.visited, cls: 'ok' },
    { label: 'Осталось', value: st.remaining },
    { label: 'Priority A осталось', value: st.remainingA, cls: 'a' },
    { label: 'Контактов получено', value: st.contacts, cls: 'contact' },
    { label: 'Follow-up', value: st.followUp, cls: 'follow' },
    { label: 'Получить цену', value: st.price, cls: 'price' },
    { label: 'Пропущено', value: st.skipped },
  ];
  const pct = Math.round(((st.visited + st.skipped) / st.total) * 100);
  const todo = POINTS.filter((p) => states[p.id].followUp || states[p.id].price);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

  return (
    <div className="stats">
      <div className="progress" aria-label={`Отработано ${pct}%`}>
        <div className="progress-bar" style={{ width: `${pct}%` }} />
        <span>Отработано {pct}%</span>
      </div>
      <div className="tiles">
        {tiles.map((t) => (
          <div key={t.label} className={`tile ${t.cls ?? ''}`}>
            <span className="tile-value">{t.value}</span>
            <span className="tile-label">{t.label}</span>
          </div>
        ))}
      </div>

      <h3>По группам карты</h3>
      <table className="group-table">
        <thead>
          <tr>
            <th>Группа</th>
            <th>Всего</th>
            <th>Посещ.</th>
            <th>Ост.</th>
          </tr>
        </thead>
        <tbody>
          {ALL_GROUPS.map((g) => {
            const ps = POINTS.filter((p) => p.mapGroup === g);
            return (
              <tr key={g}>
                <td>{g}</td>
                <td>{ps.length}</td>
                <td>{ps.filter((p) => states[p.id].visit === 'visited').length}</td>
                <td>{ps.filter((p) => states[p.id].visit === 'pending').length}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {todo.length > 0 && (
        <>
          <h3>Follow-up и запросы цены</h3>
          {todo.map((p) => (
            <button key={p.id} className="row" onClick={() => onOpen(p.id)}>
              <PriorityBadge p={p} />
              <span className="row-main">
                <span className="row-title">{p.company}</span>
                <span className="muted small">
                  {[states[p.id].followUp && 'Follow-up', states[p.id].price && 'Получить цену'].filter(Boolean).join(' · ')}
                  {states[p.id].notes && ` — ${states[p.id].notes}`}
                </span>
              </span>
              <span className="row-loc">
                <b>{p.hall}</b>
                <span className="small">{p.booth}</span>
              </span>
            </button>
          ))}
        </>
      )}

      <h3>Данные</h3>
      <p className="muted small">Статусы хранятся только на этом устройстве (localStorage). Делайте резервную копию.</p>
      <div className="data-btns">
        <button className="btn btn-secondary" onClick={() => download(`altiora-canton-${stamp}.csv`, toCsv(COLUMNS, states), 'text/csv;charset=utf-8')}>
          Экспорт CSV (все поля + статусы)
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => download(`altiora-canton-backup-${stamp}.json`, JSON.stringify(snapshot, null, 1), 'application/json')}
        >
          Резервная копия JSON
        </button>
        <button className="btn btn-secondary" onClick={() => file.current?.click()}>
          Восстановить из JSON
        </button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              const parsed = JSON.parse(await f.text()) as Persisted;
              if (!parsed || typeof parsed.states !== 'object') throw new Error('bad');
              const merged: Persisted = { currentHall: parsed.currentHall ?? null, states: { ...states } };
              for (const p of POINTS) if (parsed.states[p.id]) merged.states[p.id] = { ...states[p.id], ...parsed.states[p.id] };
              onImport(merged);
              alert('Статусы восстановлены.');
            } catch {
              alert('Не удалось прочитать файл резервной копии.');
            }
          }}
        />
        <button
          className="btn btn-danger"
          onClick={() => {
            if (confirm('Сбросить все статусы и заметки к исходным значениям из Excel?')) onReset();
          }}
        >
          Сбросить все статусы
        </button>
      </div>
      <p className="muted small">
        Источник: Canton_Fair_Phase1_FULL_64_POINTS_MASTER.xlsx, лист FULL MASTER LIST — {POINTS.length} строк, {COLUMNS.length} колонок.
      </p>
    </div>
  );
}
