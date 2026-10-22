import { useMemo } from 'react';
import { ALL_CATEGORIES, ALL_GROUPS, ALL_HALLS, ALL_PRIORITIES, HAS_APLUS, POINTS, isAPlus } from '../data';
import { matchesQuery, matchesStatus, priorityRank } from '../logic';
import type { PointState, StatusFilter } from '../types';
import { GroupTag, PriorityBadge, StatusPills } from './common';
import { groupColor } from '../groups';
import { boothsLabel, hallLabel, hallShort } from '../labels';

export interface Filters {
  q: string;
  priority: string;
  hall: string;
  category: string;
  group: string;
  status: '' | StatusFilter;
}

export const EMPTY_FILTERS: Filters = { q: '', priority: '', hall: '', category: '', group: '', status: '' };

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'pending', label: 'Не посещено' },
  { value: 'visited', label: 'Посетила' },
  { value: 'price', label: 'Получить цену' },
  { value: 'followUp', label: 'Follow-up' },
  { value: 'skipped', label: 'Пропущено' },
  { value: 'contact', label: 'Контакт получен' },
];

interface Props {
  states: Record<number, PointState>;
  filters: Filters;
  setFilters: (f: Filters) => void;
  onOpen: (id: number) => void;
}

function Select({ value, onChange, label, options }: { value: string; onChange: (v: string) => void; label: string; options: { value: string; label: string }[] }) {
  return (
    <select className={value ? 'set' : ''} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">{label}: все</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function ListView({ states, filters, setFilters, onOpen }: Props) {
  const set = (patch: Partial<Filters>) => setFilters({ ...filters, ...patch });
  const list = useMemo(
    () =>
      POINTS.filter(
        (p) =>
          matchesQuery(p, filters.q) &&
          (!filters.priority || (filters.priority === 'A+' ? isAPlus(p) : p.priority === filters.priority)) &&
          (!filters.hall || p.halls.includes(filters.hall)) &&
          (!filters.category || p.category === filters.category) &&
          (!filters.group || p.mapGroup === filters.group) &&
          (!filters.status || matchesStatus(states[p.id], filters.status)),
      ).sort((a, b) => priorityRank(a) - priorityRank(b) || a.id - b.id),
    [filters, states],
  );
  const active = Object.values(filters).some(Boolean);
  const opts = (xs: string[]) => xs.map((x) => ({ value: x, label: x }));

  return (
    <div className="list">
      <div className="filters">
        <input
          type="search"
          className="search"
          placeholder="Поиск: компания, товар, павильон, стенд"
          value={filters.q}
          onChange={(e) => set({ q: e.target.value })}
        />
        <div className="filter-grid">
          <Select label="Приоритет" value={filters.priority} onChange={(v) => set({ priority: v })} options={opts(HAS_APLUS ? ['A+', ...ALL_PRIORITIES] : ALL_PRIORITIES)} />
          <Select label="Павильон" value={filters.hall} onChange={(v) => set({ hall: v })} options={ALL_HALLS.map((h) => ({ value: h, label: hallLabel(h) }))} />
          <Select label="Направление" value={filters.category} onChange={(v) => set({ category: v })} options={opts(ALL_CATEGORIES)} />
          <Select label="Группа" value={filters.group} onChange={(v) => set({ group: v })} options={opts(ALL_GROUPS)} />
          <Select label="Статус" value={filters.status} onChange={(v) => set({ status: v as Filters['status'] })} options={STATUS_OPTIONS} />
          {active && (
            <button className="btn-link" onClick={() => setFilters(EMPTY_FILTERS)}>
              Сбросить фильтры
            </button>
          )}
        </div>
      </div>
      <div className="muted small count">
        Найдено: {list.length} из {POINTS.length}
      </div>
      {list.map((p) => {
        const s = states[p.id];
        return (
          <button
            key={p.id}
            className={`row ${s.visit !== 'pending' ? 'row-done' : ''}`}
            style={{ borderLeftColor: groupColor(p.mapGroup) }}
            onClick={() => onOpen(p.id)}
          >
            <PriorityBadge p={p} />
            <span className="row-main">
              <span className="row-title">{p.company}</span>
              <span className="muted small">
                #{p.id} · {p.category}
              </span>
              <GroupTag group={p.mapGroup} short />
              <StatusPills s={s} />
            </span>
            <span className="row-loc">
              <b>{hallShort(p.halls[0] ?? p.hall)}</b>
              <span className="small">стенд {boothsLabel(p.booths.map((b) => b.label))}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
