import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { POINTS } from './data';
import { AMAP_KEY } from './amap';
import { WALK_M_PER_MIN, fitGeoref, hallCenter } from './geo';
import { haversine } from './coords';
import { COMPLEX_WGS, loadPoiCache, savePoiCache, toHallGeo, type PoiCache } from './poi';
import { MAX_MARK_ACC_M, loadMarks, makeMark, saveMarks, upsertMark } from './marks';
import type { HallGeo } from './geo';
import { lockFromPlan, lockIsStale, planCost, planFromLock, planRoute, type Plan, type Start } from './route';
import { computeStats } from './stats';
import { useAppStore } from './store';
import type { PointState } from './types';
import { useGps } from './useGps';
import { boothLabel, hallLabel, zoneOf, type From, type ZoneId } from './labels';
import type { NavState } from './nav';
import { BOX_W, NODES, ROW_H, ROW_TOP, Y_PROMENADE, entrancePoint, inVenue, nodeAt, nodeOfHall, pathLength, walkPath, walkPathFromPoint, type Pt } from './venue';
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

/** Zone of the nearest building to a plan position (for directions while walking between pavilions). */
function nearestZone(p: Pt): ZoneId | null {
  let best: { d: number; z: ZoneId } | null = null;
  for (const n of NODES) {
    const cx = n.x + BOX_W / 2;
    const cy = ROW_TOP[n.row] + ROW_H[n.row] / 2;
    const d = Math.hypot(cx - p.x, cy - p.y);
    if (!best || d < best.d) best = { d, z: n.area as ZoneId };
  }
  return best?.z ?? null;
}

const NAV_KEY = 'altiora-nav';
function readNav(): NavState {
  try {
    const v = JSON.parse(localStorage.getItem(NAV_KEY) ?? 'null');
    if (v && typeof v.on === 'boolean' && typeof v.idx === 'number') return { on: v.on, idx: v.idx, key: String(v.key ?? '') };
  } catch {
    /* ignore */
  }
  return { on: false, idx: 0, key: '' };
}

const AmapView = lazy(() => import('./components/AmapView').then((m) => ({ default: m.AmapView })));

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
  // Navigation mode ("Начать маршрут"): survives tab and Карта/Схема switches and reloads.
  const [nav, setNavState] = useState<NavState>(readNav);
  const setNav = (n: NavState) => {
    setNavState(n);
    try {
      localStorage.setItem(NAV_KEY, JSON.stringify(n));
    } catch {
      /* not remembered */
    }
  };
  const [sheetHall, setSheetHall] = useState<string | null>(null);
  const [mapKind, setMapKind] = useState<'geo' | 'schema'>(() => {
    try {
      const saved = localStorage.getItem('altiora-map-kind');
      if (saved === 'geo' || saved === 'schema') return saved;
    } catch {
      /* ignore */
    }
    // Real AMap map by default when a key is configured; the hall schema is the fallback.
    return AMAP_KEY ? 'geo' : 'schema';
  });
  // Header height → CSS variable, so the map screen can take exactly the remaining viewport.
  const headRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const head = headRef.current;
    const tabs = tabsRef.current;
    if (!head || !tabs) return;
    const set = () => {
      document.documentElement.style.setProperty('--head-h', `${head.offsetHeight}px`);
      document.documentElement.style.setProperty('--tabs-h', `${tabs.offsetHeight}px`);
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(head);
    ro.observe(tabs);
    return () => ro.disconnect();
  }, []);
  const chooseMap = (k: 'geo' | 'schema') => {
    setMapKind(k);
    try {
      localStorage.setItem('altiora-map-kind', k);
    } catch {
      /* ignore */
    }
  };  const mapSwitch = (
    <div className="segmented seg-mini" role="tablist" aria-label="Вид карты">
      <button role="tab" aria-selected={mapKind === 'geo'} className={mapKind === 'geo' ? 'on' : ''} onClick={() => chooseMap('geo')}>
        Карта
      </button>
      <button role="tab" aria-selected={mapKind === 'schema'} className={mapKind === 'schema' ? 'on' : ''} onClick={() => chooseMap('schema')}>
        Схема
      </button>
    </div>
  );


  const { lock } = store;
  const [suggest, setSuggest] = useState<{ savingM: number } | null>(null);

  // ---- GPS + georeference ----
  useEffect(() => {
    if (tab === 'map' && !store.gpsOn) store.setGpsOn(true); // permission is requested on first use of the map
  }, [tab, store.gpsOn, store.setGpsOn]);
  const gps = useGps(store.gpsOn);
  const [pois, setPois] = useState<PoiCache | null>(loadPoiCache);
  const onPois = (c: PoiCache) => {
    setPois(c);
    savePoiCache(c);
  };
  // Real hall coordinates found through AMap POI search refine the plan ↔ GPS georeference.
  const [marks, setMarks] = useState<HallGeo[]>(loadMarks);
  // Real hall coordinates: on-site GPS marks win over AMap POIs for the same building.
  const realHalls = useMemo(() => {
    const m = new Map<string, HallGeo>(toHallGeo(pois).map((h) => [h.hall, h]));
    for (const h of marks) m.set(h.hall, h);
    return Array.from(m.values());
  }, [pois, marks]);
  const geo = useMemo(() => fitGeoref(store.anchors, realHalls), [store.anchors, realHalls]);
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
  // An explicit "Я в павильоне" choice wins over the GPS guess.
  const legSameHall =
    !!first &&
    ((currentHall ? nodeOfHall(currentHall) === nodeOfHall(first.hall) : false) || (gpsStart ? nodeAt(gpsStart, 0)?.id === nodeOfHall(first.hall) : false));
  const legMeters = pathLength(legPath) * geo.mPerUnit;
  const legInfo: LegInfo | null = first
    ? {
        meters: legMeters,
        minutes: Math.max(1, Math.round(legMeters / WALK_M_PER_MIN)),
        sameHall: legSameHall,
        known: legSameHall || legPath.length > 0,
        fromGps: !!gpsStart,
        approx: !gpsInside || (geo.quality !== 'calibrated' && geo.quality !== 'real'),
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
    outsideMeters: gps.fix && !gpsInside ? haversine([gps.fix.lon, gps.fix.lat], COMPLEX_WGS) : null,
    target: firstLatLon,
  };

  // Where the user is, for "Куда идти": chosen hall (with floor) wins; else the GPS building; else outside.
  const gpsBuilding = gpsView.hallGuess;
  // Approach side from GPS: north of the Pearl Promenade → Yuejiang Zhonglu side, otherwise Xingang Donglu.
  const approach: 'north' | 'south' = gpsVenue && gpsVenue.y < Y_PROMENADE ? 'north' : 'south';
  const from: From = gps.fix && !gpsInside && !currentHall
    ? { hall: null, outside: true, approach }
    : currentHall
      ? { hall: currentHall }
      : gpsBuilding
        ? { hall: gpsBuilding }
        : { hall: null, outside: !!gps.fix && !gpsInside, zone: gpsInside && gpsVenue ? nearestZone(gpsVenue) : null, approach };

  // Path the navigator follows: GPS / current hall → point #1; with no position, from the zone entrance
  // on the approach side (the same entrance the step list names).
  const navOrigin: 'gps' | 'hall' | 'entrance' | null = legPath.length
    ? gpsStart
      ? 'gps'
      : 'hall'
    : first && !legSameHall && !currentHall && !gpsStart
      ? 'entrance'
      : null;
  const navPath: Pt[] =
    navOrigin === 'entrance' && first ? walkPathFromPoint(entrancePoint(zoneOf(first.hall) ?? 'A', from.approach ?? 'south'), first.hall) : legPath;

  /** "📍 Отметить: я в павильоне X" — the real GPS fix becomes this hall's coordinate (and refines the georeference). */
  const markHall = (hall: string) => {
    if (!hallCenter(hall) || !gps.fix) return;
    if (gps.fix.acc > MAX_MARK_ACC_M) {
      setToast({ text: `GPS слишком неточный (±${Math.round(gps.fix.acc)} м). Подойдите к окну или выходу и попробуйте снова.` });
      return;
    }
    const next = upsertMark(marks, makeMark(hall, gps.fix));
    setMarks(next);
    saveMarks(next);
    store.setCurrentHall(hall);
    setToast({ text: `📍 ${hallLabel(hall)} отмечен на карте (±${Math.round(gps.fix.acc)} м).` });
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
        (n ? ` Следующая: ${n.point.company} — ${hallLabel(n.hall)}, стенд ${boothLabel(n.booths[0] ?? '')}` : ' Все точки маршрута отработаны.'),
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

  const startNav = (hall: string) => {
    setNav({ on: true, idx: 0, key: '' });
    showMap(hall);
  };

  const toggle = (id: number, key: 'price' | 'followUp' | 'contact') => store.update(id, { [key]: !states[id][key] });

  const open = openId != null ? POINTS.find((p) => p.id === openId) : undefined;
  const openStep = open ? plan.steps.find((st) => st.point.id === open.id) : undefined;
  const openOwn = open ? open.booths.filter((b) => b.hall === open.halls[0]).map((b) => b.label) : [];
  const openBooths = open ? (openOwn.length ? openOwn : open.booths.map((b) => b.label)) : [];

  return (
    <div className={`app ${tab === 'map' ? 'app-map' : ''}`}>
      <div className="sticky-head" ref={headRef}>
      <header className="top">
        <div className="brand">
          <span className="logo">ALTIORA</span>
          <span className="sub">Canton Fair Map · Phase 1</span>
        </div>
        <button className={`hall-chip ${currentHall ? '' : 'unset'}`} onClick={() => setHallOpen(true)}>
          <span className="small">Я в павильоне</span>
          <b>{currentHall ? currentHall.split('.')[0] : '—'}</b>
          {currentHall && <span className="small">{currentHall.endsWith('.0') ? 'площадка' : `${currentHall.split('.')[1]} этаж`}</span>}
        </button>
      </header>
      <div className={`statbar ${tab === 'map' ? 'statbar-hidden' : ''}`}>
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

      <main className={tab === 'map' ? 'main-map' : ''}>
        {tab === 'next' && (
          <NextView
            plan={plan}
            mode={routeMode}
            onMode={store.setRouteMode}
            onShowMap={showMap}
            onStart={startNav}
            states={states}
            current={currentHall}
            onPickHall={() => setHallOpen(true)}
            onOpen={setOpenId}
            leg={legInfo}
            suggest={suggest}
            onReplan={() => replan()}
            from={from}
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
        {tab === 'map' && mapKind === 'geo' && (
          <Suspense fallback={<div className="gps-panel">Загружаю карту…</div>}>
          <AmapView
            switcher={mapSwitch}
            states={states}
            plan={plan}
            current={currentHall}
            gps={gpsView}
            leg={legInfo}
            suggest={suggest}
            pois={pois}
            marks={marks}
            from={from}
            onPois={onPois}
            onReplan={() => replan()}
            onDismissSuggest={() => setSuggest(null)}
            onVisited={(id) => finish(id, 'visited')}
            onOpen={setOpenId}
            onHall={setSheetHall}
            onCalibrate={markHall}
            onEnableGps={() => store.setGpsOn(true)}
            onPickHall={() => setHallOpen(true)}
            onSchema={() => chooseMap('schema')}
            venueToWgs={geo.toLatLon}
            nav={nav}
            onNav={setNav}
            navPath={navPath}
            navOrigin={navOrigin}
          />
          </Suspense>
        )}
        {tab === 'map' && mapKind === 'schema' && (
          <MapView
            switcher={mapSwitch}
            from={from}
            plan={plan}
            states={states}
            current={currentHall}
            focusHall={focusHall}
            onHall={setSheetHall}
            gps={gpsView}
            legPath={legPath}
            nav={nav}
            onNav={setNav}
            navPath={navPath}
            navOrigin={navOrigin}
            leg={legInfo}
            suggest={suggest}
            onReplan={() => replan()}
            onDismissSuggest={() => setSuggest(null)}
            onVisited={(id) => finish(id, 'visited')}
            onOpen={setOpenId}
            onCalibrate={markHall}
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

      <nav className="tabs" ref={tabsRef}>
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
          onClose={() => setOpenId(null)}
          onVisited={() => finish(open.id, 'visited')}
          onSkip={() => finish(open.id, 'skipped')}
          onToggle={(k) => toggle(open.id, k)}
          onReset={() => store.update(open.id, { visit: 'pending' })}
          onNotes={(notes) => store.update(open.id, { notes })}
          onShowMap={() => (openStep && openStep === plan.steps[0] ? startNav(openStep.hall) : showMap(openStep?.hall ?? open.halls[0]))}
          startLabel={openStep && openStep === plan.steps[0] ? undefined : '🗺 Показать на карте'}
          hall={openStep?.hall ?? open.halls[0]}
          booths={openStep?.booths ?? openBooths}
          from={from}
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
          onMark={gps.fix ? (h) => { markHall(h); setSheetHall(null); } : undefined}
        />
      )}
      {hallOpen && (
        <HallSelector current={currentHall} states={states} onSelect={selectHall} onClose={() => setHallOpen(false)} />
      )}
    </div>
  );
}
