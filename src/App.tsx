import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { POINTS } from './data';
import { HALL_GEO, WALK_M_PER_MIN, fitGeoref, hallCenter } from './geo';
import { lockFromPlan, lockIsStale, planCost, planFromLock, planRoute, type Plan, type Start } from './route';
import { computeStats } from './stats';
import { useAppStore } from './store';
import type { PointState } from './types';
import { useGps } from './useGps';
import { inVenue, nodeAt, nodeOfHall, pathLength, walkPath, walkPathFromPoint, type Pt } from './venue';
import { HallSelector } from './components/HallSelector';
import { HallSheet } from './components/HallSheet';
import { MapView, type GpsView, type LegInfo } from './components/MapView';
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

const GeoMapView = lazy(() => import('./components/GeoMapView').then((m) => ({ default: m.GeoMapView })));

/** GPS fixes worse than this are shown but not used as the route start. */
const MAX_START_ACC_M = 150;

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
  const [mapKind, setMapKind] = useState<'geo' | 'schema'>(() => {
    try {
      const saved = localStorage.getItem('altiora-map-kind');
      if (saved === 'geo' || saved === 'schema') return saved;
    } catch {
      /* ignore */
    }
    // Real map by default once OSM hall polygons are bundled; until then the schema keeps markers and route.
    return HALL_GEO.length ? 'geo' : 'schema';
  });
  const chooseMap = (k: 'geo' | 'schema') => {
    setMapKind(k);
    try {
      localStorage.setItem('altiora-map-kind', k);
    } catch {
      /* ignore */
    }
  };

  const { lock } = store;
  const [suggest, setSuggest] = useState<{ savingM: number } | null>(null);

  // ---- GPS + georeference ----
  useEffect(() => {
    if (tab === 'map' && !store.gpsOn) store.setGpsOn(true); // permission is requested on first use of the map
  }, [tab, store.gpsOn, store.setGpsOn]);
  const gps = useGps(store.gpsOn);
  const geo = useMemo(() => fitGeoref(store.anchors), [store.anchors]);
  const gpsVenue: Pt | null = gps.fix ? geo.toVenue(gps.fix.lat, gps.fix.lon) : null;
  const gpsInside = !!gpsVenue && inVenue(gpsVenue);
  // Route start = real position: inside the complex, or nearby outside it (the first hall is chosen from there).
  const gpsNear = !!gpsVenue && Math.hypot(gpsVenue.x - 8, gpsVenue.y - 4) * geo.mPerUnit < 5000;
  const gpsStart: Pt | null = gpsNear && gps.fix!.acc <= MAX_START_ACC_M ? gpsVenue : null;
  const startNow: Start = gpsStart ?? currentHall;

  const latest = useRef({ states, routeMode, startNow });
  const justReplanned = useRef(false);
  latest.current = { states, routeMode, startNow };

  // ---- locked route: recomputed only on explicit events ----
  const replan = useCallback(
    (opts: { states?: Record<number, PointState>; start?: Start } = {}): Plan => {
      const st = opts.states ?? latest.current.states;
      const start = opts.start !== undefined ? opts.start : latest.current.startNow;
      const p = planRoute(st, start, latest.current.routeMode);
      store.setLock(lockFromPlan(p, latest.current.routeMode, start));
      setSuggest(null);
      justReplanned.current = true;
      return p;
    },
    [store],
  );

  const stale = lockIsStale(lock, states, routeMode);
  useEffect(() => {
    if (stale) replan();
  }, [stale, replan]);
  const plan = useMemo(
    () => (lock && !stale ? planFromLock(lock, states) : planRoute(states, startNow, routeMode)),
    // startNow only matters for the transient fallback before the lock is written
    [lock, stale, states, routeMode],
  );

  // First usable GPS fix: start the route from the real position (once per session).
  const gpsPlanned = useRef(false);
  useEffect(() => {
    if (!gpsStart || gpsPlanned.current) return;
    gpsPlanned.current = true;
    if (lock?.start !== 'gps') replan({ start: gpsStart });
  }, [gpsStart, lock, replan]);

  // Deviation check: suggest (never force) a shorter route, throttled.
  const lastCheck = useRef<{ t: number; p: Pt } | null>(null);
  useEffect(() => {
    if (!gpsStart || !plan.steps.length) return;
    const now = Date.now();
    if (justReplanned.current) {
      // The plan in this commit may predate the new lock: wait for the next real movement.
      justReplanned.current = false;
      lastCheck.current = { t: now, p: gpsStart };
      return;
    }
    const lc = lastCheck.current;
    if (lc && now - lc.t < 20000 && Math.hypot(lc.p.x - gpsStart.x, lc.p.y - gpsStart.y) * geo.mPerUnit < 40) return;
    lastCheck.current = { t: now, p: gpsStart };
    const fresh = planRoute(states, gpsStart, routeMode);
    const cur = planCost(plan, gpsStart);
    const alt = planCost(fresh, gpsStart);
    const savingM = (cur - alt) * geo.mPerUnit;
    setSuggest(alt < cur * 0.95 && savingM > 250 ? { savingM } : null);
  }, [gpsStart, plan, states, routeMode, geo.mPerUnit]);

  // ---- current leg: GPS (or current hall) → point #1 ----
  const first = plan.steps[0];
  const legPath: Pt[] = first ? (gpsStart ? walkPathFromPoint(gpsStart, first.hall) : currentHall ? walkPath(currentHall, first.hall) : []) : [];
  const legSameHall = !!first && (gpsStart ? nodeAt(gpsStart, 0)?.id === nodeOfHall(first.hall) : currentHall ? nodeOfHall(currentHall) === nodeOfHall(first.hall) : false);
  const legMeters = pathLength(legPath) * geo.mPerUnit;
  const legInfo: LegInfo | null = first
    ? {
        meters: legMeters,
        minutes: Math.max(1, Math.round(legMeters / WALK_M_PER_MIN)),
        sameHall: legSameHall,
        known: legSameHall || legPath.length > 0,
        fromGps: !!gpsStart,
        approx: !gpsInside || (geo.quality !== 'calibrated' && geo.quality !== 'osm'),
        via: gpsStart && !gpsInside ? 'straight' : 'walkways',
      }
    : null;

  const firstTarget = first ? hallCenter(first.hall) : null;
  const firstLatLon = firstTarget ? geo.toLatLon(firstTarget) : null;
  const gpsView: GpsView = {
    status: gps.status,
    message: gps.message,
    fix: gps.fix,
    venue: gpsVenue,
    inside: gpsInside,
    usable: !!gpsStart && gpsInside,
    quality: geo.quality,
    mPerUnit: geo.mPerUnit,
    hallGuess: gpsStart ? nodeAt(gpsStart)?.id ?? null : null,
    outsideMeters: gpsVenue && !gpsInside ? Math.hypot(gpsVenue.x - 8, gpsVenue.y - 4) * geo.mPerUnit : null,
    target: firstLatLon,
  };

  const calibrate = (hall: string) => {
    const c = hallCenter(hall);
    if (!c || !gps.fix) return;
    store.addAnchor({ x: c.x, y: c.y, lat: gps.fix.lat, lon: gps.fix.lon, acc: gps.fix.acc, kind: 'calib', label: `Hall ${hall}`, at: new Date().toISOString() });
    store.setCurrentHall(hall);
  };

  const selectHall = (h: string | null) => {
    store.setCurrentHall(h);
    setFocusHall(h);
    if (h) replan({ start: h }); // manual hall choice → re-plan from that hall
  };

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
    const wasFirst = plan.steps[0]?.point.id === id;
    store.update(id, { visit });
    const nextStates = { ...states, [id]: { ...prev, visit } };
    let hall = currentHall;
    if (visit === 'visited') {
      // The user is physically at this booth now: the hall where the route sent them.
      hall = plan.steps.find((st) => st.point.id === id)?.hall ?? (currentHall && p.halls.includes(currentHall) ? currentHall : p.halls[0]);
      store.setCurrentHall(hall);
    }
    // Visiting point #1 keeps the locked order (#2 becomes next). Out-of-order visits and skips re-plan.
    const nextPlan =
      visit === 'visited' && wasFirst && lock
        ? planFromLock(lock, nextStates)
        : replan({ states: nextStates, start: visit === 'visited' ? hall : startNow });
    const n = nextPlan.steps[0];
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
            leg={legInfo}
            suggest={suggest}
            onReplan={() => replan()}
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
        {tab === 'map' && (
          <div className="segmented map-kind" role="tablist" aria-label="Вид карты">
            <button role="tab" aria-selected={mapKind === 'geo'} className={mapKind === 'geo' ? 'on' : ''} onClick={() => chooseMap('geo')}>
              🗺 Карта
            </button>
            <button role="tab" aria-selected={mapKind === 'schema'} className={mapKind === 'schema' ? 'on' : ''} onClick={() => chooseMap('schema')}>
              ▦ Схема залов
            </button>
          </div>
        )}
        {tab === 'map' && mapKind === 'geo' && (
          <Suspense fallback={<div className="gps-panel">Загружаю карту…</div>}>
          <GeoMapView
            plan={plan}
            states={states}
            current={currentHall}
            georef={geo}
            gps={gpsView}
            legPath={legPath}
            leg={legInfo}
            suggest={suggest}
            onReplan={() => replan()}
            onDismissSuggest={() => setSuggest(null)}
            onVisited={(id) => finish(id, 'visited')}
            onOpen={setOpenId}
            onHall={setSheetHall}
            onCalibrate={calibrate}
            onEnableGps={() => store.setGpsOn(true)}
            onPickHall={() => setHallOpen(true)}
          />
          </Suspense>
        )}
        {tab === 'map' && mapKind === 'schema' && (
          <MapView
            plan={plan}
            states={states}
            current={currentHall}
            focusHall={focusHall}
            onHall={setSheetHall}
            gps={gpsView}
            legPath={legPath}
            leg={legInfo}
            suggest={suggest}
            onReplan={() => replan()}
            onDismissSuggest={() => setSuggest(null)}
            onVisited={(id) => finish(id, 'visited')}
            onOpen={setOpenId}
            onCalibrate={calibrate}
            onEnableGps={() => store.setGpsOn(true)}
            onPickHall={() => setHallOpen(true)}
          />
        )}
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
          onSetCurrent={selectHall}
        />
      )}
      {hallOpen && (
        <HallSelector current={currentHall} states={states} onSelect={selectHall} onClose={() => setHallOpen(false)} />
      )}
    </div>
  );
}
