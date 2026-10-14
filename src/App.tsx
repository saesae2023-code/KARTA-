import { useEffect, useMemo, useState } from 'react';
import { POINTS } from './data';
import { planRoute } from './route';
import { computeStats } from './stats';
import { useAppStore } from './store';
import type { PointState } from './types';
import { HallSelector } from './components/HallSelector';
import { HallSheet } from './components/HallSheet';
import { MapView } from './components/MapView';
import { ListView, EMPTY_FILTERS, type Filters } from './components/ListView';
import { NextView } from './components/NextView';
import { PointDetail } from './components/PointDetail';
import { RouteView } from './components/RouteView';
import { StatsView } from './components/StatsView';

type Tab = 'next' | 'route' | 'map' | 'list' | 'stats';

interface Toast {
  text: string;
  undo?: { id: number; prev: PointState; prevHall: string | null };
  nextId?: number;
}

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'next', label: 'Далее', icon: '➜' },
  { id: 'route', label: 'Маршрут', icon: '⇄' },
  { id: 'map', label: 'Карта', icon: '◫' },
  { id: 'list', label: 'Список', icon: '☰' },
  { id: 'stats', label: 'Статистика', icon: '▦' },
];

export default function App() {
  const store = useAppStore();
  const { states, currentHall, routeMode } = store;
  const [tab, setTab] = useState<Tab>('next');
  const [openId, setOpenId] = useState<number | null>(null);
  const [hallOpen, setHallOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [toast, setToast] = useState<Toast | null>(null);
  const [focusHall, setFocusHall] = useState<string | null>(null);
  const [sheetHall, setSheetHall] = useState<string | null>(null);

  const plan = useMemo(() => planRoute(states, currentHall, routeMode), [states, currentHall, routeMode]);
  const stats = computeStats(states);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpenId(null);
      setHallOpen(false);
      setSheetHall(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const finish = (id: number, visit: 'visited' | 'skipped') => {
    const p = POINTS.find((x) => x.id === id)!;
    const prev = states[id];
    const prevHall = currentHall;
    store.update(id, { visit });
    let hall = currentHall;
    if (visit === 'visited') {
      // The user is physically at this booth now: the hall where the route sent them.
      hall = plan.steps.find((st) => st.point.id === id)?.hall ?? (currentHall && p.halls.includes(currentHall) ? currentHall : p.halls[0]);
      store.setCurrentHall(hall);
    }
    const n = planRoute({ ...states, [id]: { ...prev, visit } }, hall, routeMode).steps[0];
    setToast({
      text:
        (visit === 'visited' ? `✓ ${p.company} — посещено.` : `${p.company} — пропущено.`) +
        (n ? ` Следующая: ${n.point.company}, Hall ${n.hall} → ${n.booths[0]}` : ' Все точки маршрута отработаны.'),
      undo: { id, prev, prevHall },
      nextId: n?.point.id,
    });
    setFocusHall(n?.hall ?? null);
    setOpenId(null);
    setSheetHall(null);
    if (tab !== 'route' && tab !== 'map') setTab('next');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const showMap = (hall: string) => {
    setFocusHall(hall);
    setOpenId(null);
    setTab('map');
    window.scrollTo({ top: 0 });
  };

  const toggle = (id: number, key: 'price' | 'followUp' | 'contact') => store.update(id, { [key]: !states[id][key] });

  const open = openId != null ? POINTS.find((p) => p.id === openId) : undefined;

  return (
    <div className="app">
      <div className="sticky-head">
      <header className="top">
        <div className="brand">
          <span className="logo">ALTIORA</span>
          <span className="sub">Canton Fair Map · Phase 1</span>
        </div>
        <button className={`hall-chip ${currentHall ? '' : 'unset'}`} onClick={() => setHallOpen(true)}>
          <span className="small">Я в Hall</span>
          <b>{currentHall ?? '—'}</b>
        </button>
      </header>
      <div className="statbar">
        <span>
          <b>{stats.visited}</b>/{stats.total} посещено
        </span>
        <span>
          осталось <b>{stats.remaining}</b>
        </span>
        <span className="a">
          A: <b>{stats.remainingA}</b>
        </span>
        <span>
          ☎ <b>{stats.contacts}</b>
        </span>
        <span>
          ↻ <b>{stats.followUp}</b>
        </span>
      </div>
      </div>

      <main>
        {tab === 'next' && (
          <NextView
            plan={plan}
            mode={routeMode}
            onMode={store.setRouteMode}
            onShowMap={showMap}
            states={states}
            current={currentHall}
            onPickHall={() => setHallOpen(true)}
            onOpen={setOpenId}
            onVisited={(id) => finish(id, 'visited')}
            onSkip={(id) => finish(id, 'skipped')}
            onToggle={toggle}
          />
        )}
        {tab === 'list' && <ListView states={states} filters={filters} setFilters={setFilters} onOpen={setOpenId} />}
        {tab === 'route' && (
          <RouteView
            plan={plan}
            states={states}
            current={currentHall}
            mode={routeMode}
            onMode={store.setRouteMode}
            onOpen={setOpenId}
            onPickHall={() => setHallOpen(true)}
            onShowMap={showMap}
          />
        )}
        {tab === 'map' && <MapView plan={plan} states={states} current={currentHall} focusHall={focusHall} onHall={setSheetHall} />}
        {tab === 'stats' && (
          <StatsView states={states} snapshot={store.snapshot} onOpen={setOpenId} onImport={store.replaceAll} onReset={store.reset} />
        )}
      </main>

      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          <div className="toast-btns">
            {toast.nextId != null && (
              <button
                onClick={() => {
                  setOpenId(toast.nextId!);
                  setToast(null);
                }}
              >
                Открыть
              </button>
            )}
            {toast.undo && (
              <button
                onClick={() => {
                  const u = toast.undo!;
                  store.update(u.id, u.prev);
                  store.setCurrentHall(u.prevHall);
                  setToast(null);
                }}
              >
                Отменить
              </button>
            )}
          </div>
        </div>
      )}

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => {
              setTab(t.id);
              window.scrollTo({ top: 0 });
            }}>
            <span className="tab-icon">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      {open && (
        <PointDetail
          p={open}
          s={states[open.id]}
          current={currentHall}
          onClose={() => setOpenId(null)}
          onVisited={() => finish(open.id, 'visited')}
          onSkip={() => finish(open.id, 'skipped')}
          onToggle={(k) => toggle(open.id, k)}
          onReset={() => store.update(open.id, { visit: 'pending' })}
          onNotes={(notes) => store.update(open.id, { notes })}
          onShowMap={() => showMap(plan.steps.find((st) => st.point.id === open.id)?.hall ?? open.halls[0])}
        />
      )}
      {sheetHall && (
        <HallSheet
          hall={sheetHall}
          plan={plan}
          states={states}
          current={currentHall}
          onClose={() => setSheetHall(null)}
          onOpen={setOpenId}
          onSetCurrent={(h) => {
            store.setCurrentHall(h);
            setFocusHall(h);
          }}
        />
      )}
      {hallOpen && (
        <HallSelector current={currentHall} states={states} onSelect={(h) => {
            store.setCurrentHall(h);
            setFocusHall(h);
          }} onClose={() => setHallOpen(false)} />
      )}
    </div>
  );
}
