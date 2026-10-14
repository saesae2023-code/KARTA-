import { useEffect, useMemo, useRef, useState } from 'react';
import { AMAP_KEY, createMap, describe, loadAMap, loadRender, mapTiming, saveRender, serviceError, type AMapDiag, type AMapNS, type RenderMode } from '../amap';
import { net, netSummary, webglSupport } from '../amapDiag';
import { haversine, metersBetween, wgs84ToGcj02, type LngLat } from '../coords';
import { HALL_GEO_BY_ID, WALK_M_PER_MIN } from '../geo';
import { groupColor } from '../groups';
import { COMPLEX_GCJ, HALL_AREA, areaHits, discoverHalls, hallHits, toHallGeo, type PoiCache } from '../poi';
import type { Plan } from '../route';
import { nodeOfHall } from '../venue';
import { formatMeters, SuggestBanner } from './LegInfo';
import { GpsPanel, NextSheet, type GpsView, type LegInfo } from './MapView';

interface Props {
  plan: Plan;
  current: string | null;
  gps: GpsView;
  leg: LegInfo | null;
  suggest: { savingM: number } | null;
  pois: PoiCache | null;
  onPois: (c: PoiCache) => void;
  onReplan: () => void;
  onDismissSuggest: () => void;
  onVisited: (id: number) => void;
  onOpen: (id: number) => void;
  onHall: (hall: string) => void;
  onCalibrate: (hall: string) => void;
  onEnableGps: () => void;
  onPickHall: () => void;
  onSchema: () => void;
}

type Status = 'nokey' | 'loading' | 'ready' | 'error';

interface Walk {
  key: string;
  origin: LngLat;
  path: LngLat[] | null;
  meters: number;
  seconds: number;
  failed: boolean;
  error?: string;
}

/** Where a hall is on the AMap map (GCJ-02): its own POI, else sourced hallGeo, else only its Area POI. */
function locate(hall: string, pois: PoiCache | null): { pos: LngLat; level: 'hall' | 'area'; source: string } | null {
  const b = nodeOfHall(hall);
  const hp = hallHits(pois).get(b);
  if (hp) return { pos: hp.gcj, level: 'hall', source: `AMap POI «${hp.name}»` };
  const hg = HALL_GEO_BY_ID.get(b);
  if (hg) return { pos: wgs84ToGcj02([hg.lng, hg.lat]), level: 'hall', source: hg.source };
  const area = HALL_AREA[b];
  const ap = area ? areaHits(pois).get(area) : undefined;
  if (ap) return { pos: ap.gcj, level: 'area', source: `AMap POI «${ap.name}»` };
  return null;
}

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function AmapView(props: Props) {
  const { plan, current, gps, leg, suggest, pois, onPois, onReplan, onDismissSuggest, onVisited, onOpen, onHall, onCalibrate, onEnableGps, onPickHall, onSchema } = props;
  const box = useRef<HTMLDivElement>(null);
  const AM = useRef<AMapNS>(null);
  const map = useRef<AMapNS>(null);
  const routeLayer = useRef<AMapNS[]>([]);
  const userLayer = useRef<{ dot: AMapNS; acc: AMapNS } | null>(null);
  const [status, setStatus] = useState<Status>(AMAP_KEY ? 'loading' : 'nokey');
  const [diag, setDiag] = useState<AMapDiag | null>(null);
  const [poiError, setPoiError] = useState('');
  const [searching, setSearching] = useState(false);
  const [walk, setWalk] = useState<Walk | null>(null);
  const [follow, setFollow] = useState(false);
  const fitted = useRef(false);
  const [render, setRender] = useState<RenderMode>(loadRender);
  const changeRender = (r: RenderMode) => {
    saveRender(r);
    fitted.current = false;
    setStatus('loading');
    setRender(r);
  };

  const user: LngLat | null = gps.fix ? wgs84ToGcj02([gps.fix.lon, gps.fix.lat]) : null;
  const firstStop = plan.stops[0];
  const target = firstStop ? locate(firstStop.hall, pois) : null;

  const runSearch = (AMap: AMapNS) => {
    setSearching(true);
    discoverHalls(AMap)
      .then(onPois)
      .catch((e) => setPoiError(serviceError('error', e)))
      .finally(() => setSearching(false));
  };

  // ---- load AMap and create the map ----
  useEffect(() => {
    if (!AMAP_KEY) return;
    let destroyed = false;
    loadAMap()
      .then(async (AMap) => {
        if (destroyed || !box.current) return;
        AM.current = AMap;
        map.current = await createMap(AMap, box.current, render);
        if (destroyed) return;
        map.current.addControl(new AMap.Scale());
        setTimeout(() => map.current?.resize?.(), 300);
        setStatus('ready');
        if (!pois) runSearch(AMap);
      })
      .catch((e: unknown) => {
        if (destroyed) return;
        const d = e && typeof e === 'object' && 'stage' in e ? (e as AMapDiag) : describe(e, 'map');
        setDiag(d);
        setStatus(d.errcode === 'NO_KEY' ? 'nokey' : 'error');
        console.error('[AMap]', d);
      });
    return () => {
      destroyed = true;
      map.current?.destroy?.();
      map.current = null;
      userLayer.current = null;
      routeLayer.current = [];
    };
  }, [render]);

  // Keep AMap's canvas in sync with its container size (orientation change, panels opening).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => map.current?.resize?.());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- AMap.Walking: GPS → next target (real pedestrian polyline) ----
  useEffect(() => {
    const AMap = AM.current;
    if (status !== 'ready' || !AMap || !user || !target) return;
    const key = `${target.pos[0].toFixed(5)},${target.pos[1].toFixed(5)}`;
    if (walk && walk.key === key && metersBetween(walk.origin, user) < 30) return;
    const walking = new AMap.Walking({ hideMarkers: true, autoFitView: false });
    walking.search(new AMap.LngLat(user[0], user[1]), new AMap.LngLat(target.pos[0], target.pos[1]), (st: string, result: AMapNS) => {
      const r = st === 'complete' ? result?.routes?.[0] : null;
      if (!r) {
        setWalk({ key, origin: user, path: null, meters: metersBetween(user, target.pos), seconds: 0, failed: true, error: st === 'complete' ? 'нет маршрута' : serviceError(st, result) });
        return;
      }
      const path: LngLat[] = (r.steps ?? []).flatMap((s: AMapNS) => (s.path ?? []).map((p: AMapNS) => [p.lng ?? p.getLng(), p.lat ?? p.getLat()] as LngLat));
      setWalk({ key, origin: user, path, meters: r.distance, seconds: r.time, failed: false });
    });
  }, [status, user?.[0], user?.[1], target?.pos[0], target?.pos[1]]);

  // ---- route overlays: numbered markers + calm order line + active walking leg ----
  const markerData = useMemo(() => {
    const byBuilding = new Map<string, { nums: number[]; halls: string[]; color: string }>();
    plan.stops.forEach((s, i) => {
      const b = nodeOfHall(s.hall);
      const e = byBuilding.get(b) ?? { nums: [], halls: [], color: groupColor(s.points[0].mapGroup) };
      e.nums.push(i + 1);
      e.halls.push(s.hall);
      byBuilding.set(b, e);
    });
    // Halls known only at Area level share one marker per Area (no invented per-hall positions).
    const out: { nums: number[]; halls: string[]; color: string; loc: ReturnType<typeof locate> }[] = [];
    const byArea = new Map<string, (typeof out)[number]>();
    for (const e of byBuilding.values()) {
      const loc = locate(e.halls[0], pois);
      if (loc?.level === 'area') {
        const area = HALL_AREA[nodeOfHall(e.halls[0])];
        const g = byArea.get(area);
        if (g) {
          g.nums.push(...e.nums);
          g.halls.push(...e.halls);
        } else {
          const n = { ...e, nums: [...e.nums], halls: [...e.halls], loc };
          byArea.set(area, n);
          out.push(n);
        }
      } else out.push({ ...e, loc });
    }
    out.forEach((d) => d.nums.sort((x, y) => x - y));
    return out;
  }, [plan, pois]);

  useEffect(() => {
    const AMap = AM.current;
    const m = map.current;
    if (status !== 'ready' || !AMap || !m) return;
    m.remove(routeLayer.current);
    const layer: AMapNS[] = [];
    const ordered = markerData.filter((d) => d.loc).sort((a, b) => a.nums[0] - b.nums[0]);
    if (ordered.length > 1)
      layer.push(
        new AMap.Polyline({
          path: ordered.map((d) => d.loc!.pos),
          strokeColor: '#c8922e',
          strokeOpacity: 0.75,
          strokeWeight: 3,
          strokeStyle: 'dashed',
          strokeDasharray: [8, 6],
          zIndex: 50,
        }),
      );
    if (user && target) {
      if (walk && !walk.failed && walk.path?.length)
        layer.push(new AMap.Polyline({ path: [user, ...walk.path, target.pos], strokeColor: '#2563eb', strokeWeight: 8, strokeOpacity: 0.95, lineJoin: 'round', lineCap: 'round', zIndex: 90, showDir: true }));
      else if (walk?.failed)
        layer.push(new AMap.Polyline({ path: [user, target.pos], strokeColor: '#2563eb', strokeWeight: 3, strokeStyle: 'dashed', strokeDasharray: [2, 8], zIndex: 90 }));
    }
    for (const d of markerData) {
      if (!d.loc) continue;
      const el = document.createElement('button');
      el.className = `geo-marker${d.nums[0] === 1 ? ' first' : ''}${d.loc.level === 'area' ? ' approx' : ''}`;
      el.style.background = d.color;
      el.innerHTML = `<b>${d.nums[0]}</b>${d.nums.length > 1 ? `<i>+${d.nums.length - 1}</i>` : ''}<span>${d.loc.level === 'area' ? `Area ${HALL_AREA[nodeOfHall(d.halls[0])]} · ${d.halls.length} Hall` : d.halls[0]}</span>`;
      el.title = `Шаг ${d.nums.join(', ')} · Hall ${d.halls.join(', ')} · ${d.loc.source}`;
      el.onclick = () => onHall(d.halls[0]);
      layer.push(new AMap.Marker({ position: d.loc.pos, content: el, anchor: 'center', zIndex: 120 - Math.min(d.nums[0], 60) }));
    }
    m.add(layer);
    routeLayer.current = layer;
  }, [status, markerData, walk, user?.[0], user?.[1], target?.pos[0]]);

  // ---- user position (blue dot + accuracy), live ----
  useEffect(() => {
    const AMap = AM.current;
    const m = map.current;
    if (status !== 'ready' || !AMap || !m || !user || !gps.fix) return;
    if (!userLayer.current) {
      const el = document.createElement('div');
      el.className = 'amap-user';
      el.innerHTML = '<span>Вы здесь</span>';
      const dot = new AMap.Marker({ position: user, content: el, anchor: 'center', zIndex: 200 });
      const acc = new AMap.Circle({ center: user, radius: gps.fix.acc, strokeColor: '#2563eb', strokeWeight: 1, strokeOpacity: 0.5, fillColor: '#2563eb', fillOpacity: 0.14, zIndex: 60 });
      m.add([acc, dot]);
      userLayer.current = { dot, acc };
    } else {
      userLayer.current.dot.setPosition(user);
      userLayer.current.acc.setCenter(user);
      userLayer.current.acc.setRadius(gps.fix.acc);
    }
    if (follow) m.setCenter(user);
  }, [status, user?.[0], user?.[1], gps.fix?.acc, follow]);

  // First view: "Вы здесь" and target #1 together.
  useEffect(() => {
    const m = map.current;
    if (status !== 'ready' || !m || fitted.current) return;
    const overlays = [...routeLayer.current.filter((o: AMapNS) => o?.CLASS_NAME === 'AMap.Marker').slice(0, 1), userLayer.current?.dot].filter(Boolean);
    if (user && target) {
      fitted.current = true;
      m.setFitView(overlays.length ? overlays : null, false, [90, 90, 90, 90], 18);
    }
  }, [status, user?.[0], target?.pos[0], markerData]);

  const locateMe = () => {
    if (gps.status === 'off' || gps.status === 'denied' || gps.status === 'error') onEnableGps();
    if (user && map.current) map.current.setZoomAndCenter(18, user);
  };
  const showAll = () => map.current?.setFitView(null, false, [60, 60, 60, 60]);
  const showComplex = () => {
    setFollow(false);
    map.current?.setZoomAndCenter(16, COMPLEX_GCJ);
  };
  // Distance from the real position to the complex — far away the map has little or no AMap data.
  const farKm = user ? haversine(user, COMPLEX_GCJ) / 1000 : 0;

  const sheetLeg: LegInfo | null =
    walk && !walk.failed && user && target
      ? { meters: walk.meters, minutes: Math.max(1, Math.round(walk.seconds / 60) || Math.round(walk.meters / WALK_M_PER_MIN)), sameHall: false, known: true, fromGps: true, approx: target.level === 'area', via: 'amap' }
      : leg;

  const hallsFound = hallHits(pois);
  const areasFound = areaHits(pois);
  const routedBuildings = Array.from(new Set(plan.stops.map((s) => nodeOfHall(s.hall))));
  const missing = routedBuildings.filter((b) => !hallsFound.has(b) && !HALL_GEO_BY_ID.has(b));

  if (status === 'nokey')
    return (
      <div className="map">
        <div className="gps-panel warn amap-setup">
          <b>Нужен ключ AMap Overseas (JS API 2.0).</b>
          <span>
            На Vercel → Settings → Environment Variables добавьте <code>VITE_AMAP_KEY</code> и <code>VITE_AMAP_SECURITY_KEY</code>{' '}
            (AMap Overseas Platform), затем Redeploy — переменные VITE_ встраиваются при сборке. Пока показываю схему залов.
          </span>
          <button className="btn btn-secondary" onClick={onSchema}>
            Открыть схему залов
          </button>
        </div>
      </div>
    );

  return (
    <div className="map geo">
      <div className="map-toolbar">
        <button className="toggle locate" onClick={locateMe}>
          📍 Моё местоположение
        </button>
        <button className="toggle" onClick={showAll}>
          ⤢ Весь маршрут
        </button>
        <button className="toggle" onClick={showComplex}>
          🏢 Canton Fair
        </button>
      </div>
      <GpsPanel gps={gps} current={current} onCalibrate={onCalibrate} onEnableGps={onEnableGps} onPickHall={onPickHall} />
      {farKm > 20 && (
        <div className="gps-panel warn">
          Вы в {Math.round(farKm).toLocaleString('ru')} км от Canton Fair — там у AMap может не быть подробной карты (пустая сетка).{' '}
          <button className="btn-link" onClick={showComplex}>
            Показать Canton Fair
          </button>
        </div>
      )}
      {status === 'error' && diag && <AmapDiagPanel d={diag} onSchema={onSchema} />}
      {walk?.failed && user && (
        <div className="gps-panel warn">Маршрут приблизительный: AMap.Walking не вернул пешеходный путь ({walk.error}) — пунктир по прямой (≈ {formatMeters(walk.meters)}).</div>
      )}
      {target?.level === 'area' && firstStop && (
        <div className="gps-panel warn">
          У Hall {firstStop.hall} нет собственной точки в AMap — веду к POI зоны {HALL_AREA[nodeOfHall(firstStop.hall)]}, дальше по схеме залов.
        </div>
      )}
      {suggest && <SuggestBanner savingM={suggest.savingM} onReplan={onReplan} onDismiss={onDismissSuggest} />}
      {plan.steps[0] && (
        <NextSheet
          step={plan.steps[0]}
          leg={sheetLeg}
          follow={follow}
          onOpen={onOpen}
          onVisited={onVisited}
          onToggleFollow={() => {
            const next = !follow;
            setFollow(next);
            if (next && map.current) {
              if (user) map.current.setZoomAndCenter(18, user);
              else if (target) map.current.setZoomAndCenter(17, target.pos);
            }
          }}
        />
      )}
      <div className="geo-box">
        {/* AMap owns this element; React renders nothing inside it. */}
        <div className="amap-container" ref={box} />
        {status === 'loading' && <div className="geo-loading">Загружаю карту AMap…</div>}
      </div>
      <RenderDiag map={map.current} AMap={AM.current} status={status} render={render} box={box.current} onChange={changeRender} />
      <div className="map-keys small">
        <span><i className="k k-user" /> вы здесь (GPS)</span>
        <span><i className="k k-active" /> пешеходный маршрут AMap</span>
        <span><i className="k k-rest" /> порядок обхода</span>
        <span><i className="k k-order">1</i> шаг · цвет = товарная группа</span>
      </div>
      <div className="poi-panel small">
        <b>Координаты Hall из AMap POI</b>
        {searching ? (
          <span> · ищу…</span>
        ) : pois ? (
          <>
            <span>
              {' '}
              · найдено Hall: {hallsFound.size ? Array.from(hallsFound.keys()).sort((a, b) => +a - +b).join(', ') : 'нет'} · зон:{' '}
              {areasFound.size ? Array.from(areasFound.keys()).sort().join(', ') : 'нет'} · запросов {pois.queries}
            </span>
            {missing.length > 0 && (
              <span className="muted">
                {' '}
                · нет точки Hall в AMap: {missing.join(', ')} (показаны маркером зоны, если AMap вернул зону; иначе не показаны)
              </span>
            )}
            {pois.errors.length > 0 && <span className="muted"> · ошибки: {pois.errors.slice(0, 2).join('; ')}</span>}
            {poiError && <span className="muted"> · {poiError}</span>}
          </>
        ) : null}
        <span className="poi-btns">
          <button className="btn-link" disabled={status !== 'ready' || searching} onClick={() => AM.current && runSearch(AM.current)}>
            Повторить поиск
          </button>
          {pois && (
            <button className="btn-link" onClick={() => download('hallGeo.json', JSON.stringify(toHallGeo(pois), null, 1))}>
              Скачать hallGeo.json
            </button>
          )}
        </span>
      </div>
      <p className="muted small">
        Карта и пешеходные маршруты — AMap (高德), координаты GPS переводятся WGS-84 → GCJ-02. Порядок обхода считается графом
        проходов официальной схемы; внутри Hall — по номерам стендов (не GPS).
      </p>
    </div>
  );
}

function AmapDiagPanel({ d, onSchema }: { d: AMapDiag; onSchema: () => void }) {
  return (
    <div className="gps-panel warn amap-diag">
      <b>AMap не загрузился</b>
      <dl>
        <dt>errcode</dt>
        <dd>{d.errcode}</dd>
        <dt>errmsg</dt>
        <dd>{d.errmsg}</dd>
        <dt>errdetail</dt>
        <dd>{d.errdetail}</dd>
        <dt>этап</dt>
        <dd>{d.stage}</dd>
        <dt>endpoint</dt>
        <dd>{d.endpoint}</dd>
        <dt>window.AMap</dt>
        <dd>{d.hasAMap ? 'есть' : 'нет'}</dd>
        <dt>ключ / securityJsCode</dt>
        <dd>
          {d.keySet ? 'задан' : 'НЕТ'} / {d.securitySet ? 'задан' : 'НЕТ'} · service {d.serviceType}
        </dd>
        {d.console.length > 0 && (
          <>
            <dt>сообщения AMap</dt>
            <dd>{d.console.join(' | ')}</dd>
          </>
        )}
      </dl>
      <button className="btn btn-secondary" onClick={onSchema}>
        Открыть схему залов
      </button>
    </div>
  );
}

/** Temporary basemap diagnostics: layers, canvas, centre/zoom, complete event, AMap network activity. */
function RenderDiag({ map, AMap, status, render, box, onChange }: { map: AMapNS; AMap: AMapNS; status: Status; render: RenderMode; box: HTMLDivElement | null; onChange: (r: RenderMode) => void }) {
  const [open, setOpen] = useState(true);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => tick((x) => x + 1), 1500);
    return () => clearInterval(t);
  }, [open]);
  let layers = '—';
  let center = '—';
  let zoom = '—';
  try {
    const ls: AMapNS[] = map?.getLayers?.() ?? [];
    layers = `${ls.length}: ${ls.map((l) => `${l.CLASS_NAME ?? l.constructor?.name ?? '?'}${l.getOpacity ? ` op ${l.getOpacity()}` : ''}${l.getVisible?.() === false ? ' hidden' : ''}`).join(', ')}`;
    const c = map?.getCenter?.();
    if (c) center = `${(c.lng ?? c.getLng()).toFixed(5)}, ${(c.lat ?? c.getLat()).toFixed(5)}`;
    const z = map?.getZoom?.();
    if (z !== undefined) zoom = String(Math.round(z * 100) / 100);
  } catch (e) {
    layers = `ошибка: ${(e as Error).message}`;
  }
  const canvases = box ? Array.from(box.querySelectorAll('canvas')).map((c) => `${c.width}×${c.height} (css ${c.clientWidth}×${c.clientHeight})`) : [];
  const imgs = box ? box.querySelectorAll('img').length : 0;
  const cover = (() => {
    if (!box) return '—';
    const r = box.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) as HTMLElement | null;
    return el ? `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0] || '-'}` : '—';
  })();
  const sum = netSummary();
  const failures = net.filter((e) => /FAILED|load error|\b[45]\d\d\b/.test(e.status)).slice(-5);
  const complete = mapTiming.completeAt ? `${Math.round(mapTiming.completeAt - mapTiming.createdAt)} мс после создания` : 'нет';
  const set = (p: Partial<RenderMode>) => onChange({ ...render, ...p });
  return (
    <div className="render-diag small">
      <button className="btn-link" onClick={() => setOpen(!open)}>
        🔧 Диагностика подложки {open ? '▾' : '▸'}
      </button>
      {open && (
        <>
          <div className="rd-switch">
            <span>Режим:</span>
            {(['2D', '3D'] as const).map((v) => (
              <button key={v} className={`toggle ${render.viewMode === v ? 'on' : ''}`} onClick={() => set({ viewMode: v })}>
                {v}
              </button>
            ))}
            {([['vector', 'Вектор'], ['raster', 'Растр'], ['satellite', 'Спутник']] as const).map(([v, l]) => (
              <button key={v} className={`toggle ${render.layer === v ? 'on' : ''}`} onClick={() => set({ layer: v })}>
                {l}
              </button>
            ))}
          </div>
          <dl>
            <dt>статус / complete</dt>
            <dd>{status} / {complete}</dd>
            <dt>AMap</dt>
            <dd>{AMap ? `v${AMap.version ?? '?'}` : 'нет'} · {webglSupport()}</dd>
            <dt>слои</dt>
            <dd>{layers}</dd>
            <dt>canvas</dt>
            <dd>{canvases.length ? canvases.join('; ') : 'нет'} · img: {imgs}</dd>
            <dt>контейнер</dt>
            <dd>{box ? `${box.clientWidth}×${box.clientHeight}` : '—'} · сверху: {cover}</dd>
            <dt>центр / zoom</dt>
            <dd>{center} / {zoom}</dd>
            <dt>сеть AMap</dt>
            <dd>{sum.length ? sum.slice(0, 12).map((r) => `${r.key} ×${r.n} [${r.statuses}]`).join(' | ') : 'запросов не видно (vector-тайлы могут грузиться в Web Worker)'}</dd>
            <dt>ошибки сети</dt>
            <dd>{failures.length ? failures.map((f) => `${f.url.slice(0, 90)} → ${f.status}`).join(' | ') : 'нет'}</dd>
          </dl>
        </>
      )}
    </div>
  );
}
