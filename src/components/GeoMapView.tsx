import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { HALL_GEO, HALL_GEO_BY_ID, WALK_M_PER_MIN, hallCenter, type Georef } from '../geo';
import { groupColor } from '../groups';
import type { Plan } from '../route';
import type { PointState } from '../types';
import { NODE_BY_ID, nodeOfHall, walkPath, type Pt } from '../venue';
import { formatMeters, SuggestBanner } from './LegInfo';
import { GpsPanel, NextSheet, type GpsView, type LegInfo } from './MapView';

interface Props {
  plan: Plan;
  states: Record<number, PointState>;
  current: string | null;
  georef: Georef;
  gps: GpsView;
  legPath: Pt[];
  leg: LegInfo | null;
  suggest: { savingM: number } | null;
  onReplan: () => void;
  onDismissSuggest: () => void;
  onVisited: (id: number) => void;
  onOpen: (id: number) => void;
  onHall: (hall: string) => void;
  onCalibrate: (hall: string) => void;
  onEnableGps: () => void;
  onPickHall: () => void;
}

type LngLat = [number, number];

/** Wikipedia (zh) coordinate of the Canton Fair Complex — initial view only. */
const COMPLEX_CENTER: LngLat = [113.3553139, 23.1041361];

const RASTER_OSM: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

const BASEMAPS: { id: string; label: string; style: string | StyleSpecification }[] = [
  { id: 'ofm', label: 'OpenFreeMap', style: 'https://tiles.openfreemap.org/styles/liberty' },
  { id: 'osm', label: 'OSM', style: RASTER_OSM },
];

const OSRM_FOOT = 'https://routing.openstreetmap.de/routed-foot/route/v1/driving';

const FC = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });
const line = (coords: LngLat[], props: Record<string, unknown> = {}): GeoJSON.Feature => ({
  type: 'Feature',
  properties: props,
  geometry: { type: 'LineString', coordinates: coords },
});

function circlePolygon(center: LngLat, radiusM: number): GeoJSON.Feature {
  const [lng, lat] = center;
  const pts: LngLat[] = [];
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * 2 * Math.PI;
    pts.push([lng + (radiusM * Math.cos(a)) / (111320 * Math.cos((lat * Math.PI) / 180)), lat + (radiusM * Math.sin(a)) / 110574]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [pts] } };
}

const metres = (a: LngLat, b: LngLat) =>
  Math.hypot((a[0] - b[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180), (a[1] - b[1]) * 110574);

/** Real position of a hall: OSM building centroid; plan-derived only for areas without a building (outdoor x.0). */
function hallPosition(hall: string, georef: Georef): { pos: LngLat; real: boolean } | null {
  const g = HALL_GEO_BY_ID.get(nodeOfHall(hall));
  if (g) return { pos: [g.lng, g.lat], real: true };
  const c = hallCenter(hall);
  if (!c || !NODE_BY_ID.has(nodeOfHall(hall))) return null;
  const ll = georef.toLatLon(c);
  return { pos: [ll.lon, ll.lat], real: false };
}

interface OsrmLeg {
  key: string;
  coords: LngLat[] | null;
  meters: number;
  seconds: number;
  failed: boolean;
}

export function GeoMapView(props: Props) {
  const { plan, current, georef, gps, legPath, leg, suggest, onReplan, onDismissSuggest, onVisited, onOpen, onHall, onCalibrate, onEnableGps, onPickHall } = props;
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const [ready, setReady] = useState(0);
  const [basemap, setBasemap] = useState(0);
  const [follow, setFollow] = useState(false);
  const [osrm, setOsrm] = useState<OsrmLeg | null>(null);
  const fitted = useRef(false);
  const haveHalls = HALL_GEO.length > 0;

  const toLL = (p: Pt): LngLat => {
    const ll = georef.toLatLon(p);
    return [ll.lon, ll.lat];
  };
  const user: LngLat | null = gps.fix ? [gps.fix.lon, gps.fix.lat] : null;
  const firstStop = plan.stops[0];
  const firstPos = firstStop ? hallPosition(firstStop.hall, georef) : null;

  // ---- map lifecycle ----
  useEffect(() => {
    if (!box.current) return;
    const m = new maplibregl.Map({
      container: box.current,
      style: BASEMAPS[basemap].style,
      center: COMPLEX_CENTER,
      zoom: 15.2,
      attributionControl: { compact: true },
    });
    let errors = 0;
    m.on('error', (e) => {
      // Basemap unreachable → fall back to the next tile source.
      const msg = String((e as { error?: Error }).error?.message ?? '');
      if (/Failed to fetch|NetworkError|AJAXError|404|403|load/i.test(msg) && ++errors >= 3 && basemap < BASEMAPS.length - 1) setBasemap(basemap + 1);
    });
    m.on('load', () => {
      addOverlay(m);
      setReady((r) => r + 1);
    });
    map.current = m;
    return () => {
      markers.current.forEach((mk) => mk.remove());
      markers.current = [];
      m.remove();
      map.current = null;
    };
  }, [basemap]);

  // ---- outside the complex: real pedestrian route to hall #1 (OSRM foot, OSM data) ----
  useEffect(() => {
    if (!user || gps.inside || !firstPos) return;
    const key = `${user[0].toFixed(4)},${user[1].toFixed(4)}>${firstPos.pos[0].toFixed(5)},${firstPos.pos[1].toFixed(5)}`;
    if (osrm && (osrm.key === key || (!osrm.failed && osrm.coords && metres(osrm.coords[0], user) < 40))) return;
    const ctrl = new AbortController();
    fetch(`${OSRM_FOOT}/${user[0]},${user[1]};${firstPos.pos[0]},${firstPos.pos[1]}?overview=full&geometries=geojson`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => {
        const r = j.routes?.[0];
        if (!r) throw new Error('no route');
        setOsrm({ key, coords: r.geometry.coordinates, meters: r.distance, seconds: r.duration, failed: false });
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setOsrm({ key, coords: null, meters: metres(user, firstPos.pos), seconds: 0, failed: true });
      });
    return () => ctrl.abort();
  }, [user?.[0], user?.[1], gps.inside, firstPos?.pos[0], firstPos?.pos[1]]);

  // ---- data for overlay layers ----
  const data = useMemo(() => {
    const order = new Map<string, number>();
    plan.stops.forEach((s, i) => {
      const b = nodeOfHall(s.hall);
      if (!order.has(b)) order.set(b, i);
    });
    const nextHall = plan.stops.find((s) => s.hall !== current)?.hall ?? null;
    const halls = FC(
      HALL_GEO.map((h) => {
        const i = order.get(h.hall);
        const st = i !== undefined ? plan.stops[i] : undefined;
        return {
          type: 'Feature',
          properties: {
            hall: h.hall,
            color: st ? groupColor(st.points[0].mapGroup) : '#94a3b8',
            routed: st ? 1 : 0,
            current: current && nodeOfHall(current) === h.hall ? 1 : 0,
            next: nextHall && nodeOfHall(nextHall) === h.hall ? 1 : 0,
          },
          geometry: { type: 'Polygon', coordinates: [[...h.polygon, h.polygon[0]]] },
        } as GeoJSON.Feature;
      }),
    );

    // Remaining route between stops: venue walkways, anchored at real hall positions.
    const rest: GeoJSON.Feature[] = [];
    const stopHalls = plan.stops.map((s) => s.hall).filter((h, i, arr) => h !== arr[i - 1]);
    for (let i = 1; i < stopHalls.length; i++) {
      const a = hallPosition(stopHalls[i - 1], georef);
      const b = hallPosition(stopHalls[i], georef);
      if (!a || !b || nodeOfHall(stopHalls[i - 1]) === nodeOfHall(stopHalls[i])) continue;
      rest.push(line([a.pos, ...walkPath(stopHalls[i - 1], stopHalls[i]).map(toLL), b.pos]));
    }

    // Active leg.
    const active: GeoJSON.Feature[] = [];
    const approx: GeoJSON.Feature[] = [];
    if (firstPos) {
      if (user && !gps.inside) {
        if (osrm?.coords) active.push(line([user, ...osrm.coords, firstPos.pos]));
        else approx.push(line([user, firstPos.pos]));
      } else if (user && gps.usable) {
        const pts = legPath.map(toLL);
        if (pts.length >= 2) {
          approx.push(line([user, pts[1]]));
          active.push(line([...pts.slice(1), firstPos.pos]));
        }
      } else if (current && firstStop && nodeOfHall(current) !== nodeOfHall(firstStop.hall)) {
        const a = hallPosition(current, georef);
        if (a) active.push(line([a.pos, ...walkPath(current, firstStop.hall).map(toLL), firstPos.pos]));
      }
    }
    const userF: GeoJSON.Feature[] = user && gps.fix ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: user } }] : [];
    const accF: GeoJSON.Feature[] = user && gps.fix ? [circlePolygon(user, gps.fix.acc)] : [];
    return { halls, rest: FC(rest), active: FC(active), approx: FC(approx), user: FC(userF), acc: FC(accF) };
  }, [plan, current, georef, user?.[0], user?.[1], gps.fix?.acc, gps.inside, gps.usable, legPath, osrm, firstPos?.pos[0], firstPos?.pos[1]]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    (m.getSource('halls') as GeoJSONSource | undefined)?.setData(data.halls);
    (m.getSource('route-rest') as GeoJSONSource | undefined)?.setData(data.rest);
    (m.getSource('route-active') as GeoJSONSource | undefined)?.setData(data.active);
    (m.getSource('route-approx') as GeoJSONSource | undefined)?.setData(data.approx);
    (m.getSource('user') as GeoJSONSource | undefined)?.setData(data.user);
    (m.getSource('user-acc') as GeoJSONSource | undefined)?.setData(data.acc);
  }, [data, ready]);

  // ---- numbered markers: one per building, colour = product group of its first point ----
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    markers.current.forEach((mk) => mk.remove());
    markers.current = [];
    const byBuilding = new Map<string, { nums: number[]; halls: string[]; color: string }>();
    plan.stops.forEach((s, i) => {
      const b = nodeOfHall(s.hall);
      const e = byBuilding.get(b) ?? { nums: [], halls: [], color: groupColor(s.points[0].mapGroup) };
      e.nums.push(i + 1);
      e.halls.push(s.hall);
      byBuilding.set(b, e);
    });
    for (const [, e] of byBuilding) {
      const pos = hallPosition(e.halls[0], georef);
      if (!pos || (!haveHalls && pos.real === false)) continue;
      const el = document.createElement('button');
      el.className = `geo-marker${e.nums[0] === 1 ? ' first' : ''}${pos.real ? '' : ' approx'}`;
      el.style.background = e.color;
      el.innerHTML = `<b>${e.nums[0]}</b>${e.nums.length > 1 ? `<i>+${e.nums.length - 1}</i>` : ''}<span>${e.halls[0]}</span>`;
      el.setAttribute('aria-label', `Шаг ${e.nums.join(', ')}: Hall ${e.halls.join(', ')}`);
      el.onclick = () => onHall(e.halls[0]);
      markers.current.push(new maplibregl.Marker({ element: el }).setLngLat(pos.pos).addTo(m));
    }
  }, [plan, ready, georef]);

  // ---- camera ----
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || fitted.current) return;
    if (user && firstPos) {
      fitted.current = true;
      m.fitBounds(new maplibregl.LngLatBounds(user, user).extend(firstPos.pos), { padding: 70, maxZoom: 17.5, duration: 0 });
    } else if (haveHalls) {
      fitted.current = !!gps.fix || gps.status === 'denied' || gps.status === 'unavailable';
      const b = new maplibregl.LngLatBounds();
      HALL_GEO.forEach((h) => h.polygon.forEach((p) => b.extend(p)));
      m.fitBounds(b, { padding: 30, duration: 0 });
    }
  }, [ready, user?.[0], firstPos?.pos[0], gps.status]);

  useEffect(() => {
    if (follow && user && map.current) map.current.easeTo({ center: user, zoom: Math.max(map.current.getZoom(), 17), duration: 600 });
  }, [follow, user?.[0], user?.[1]]);

  const locate = () => {
    if (gps.status === 'off' || gps.status === 'denied' || gps.status === 'error') onEnableGps();
    if (user && map.current) map.current.flyTo({ center: user, zoom: 17.5 });
  };
  const showAll = () => {
    const m = map.current;
    if (!m) return;
    const b = new maplibregl.LngLatBounds();
    HALL_GEO.forEach((h) => h.polygon.forEach((p) => b.extend(p)));
    if (user) b.extend(user);
    if (!b.isEmpty()) m.fitBounds(b, { padding: 30 });
  };

  // Outside the complex the sheet shows the real street distance.
  const sheetLeg: LegInfo | null =
    user && !gps.inside && osrm && !osrm.failed
      ? { meters: osrm.meters, minutes: Math.max(1, Math.round(osrm.seconds / 60) || Math.round(osrm.meters / WALK_M_PER_MIN)), sameHall: false, known: true, fromGps: true, approx: false, via: 'streets' }
      : leg;

  return (
    <div className="map geo">
      <div className="map-toolbar">
        <button className="toggle locate" onClick={locate}>
          📍 Моё местоположение
        </button>
        <button className="toggle" onClick={showAll}>
          ⤢ Весь комплекс
        </button>
      </div>
      <GpsPanel gps={gps} current={current} onCalibrate={onCalibrate} onEnableGps={onEnableGps} onPickHall={onPickHall} />
      {!haveHalls && (
        <div className="gps-panel warn">
          Контуры корпусов из OpenStreetMap ещё не загружены — маркеры Hall на реальной карте не показаны (координаты не
          выдумываются). Маршрут доступен во вкладке «Схема».
        </div>
      )}
      {user && !gps.inside && osrm?.failed && (
        <div className="gps-panel warn">
          Маршрут приблизительный: сервис пешеходных маршрутов недоступен, пунктир — прямая до Hall {firstStop?.hall} (≈ {formatMeters(osrm.meters)}).
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
              if (user) map.current.flyTo({ center: user, zoom: 17.5 });
              else if (firstPos) map.current.flyTo({ center: firstPos.pos, zoom: 17 });
            }
          }}
        />
      )}
      <div className="geo-box" ref={box} />
      <div className="map-keys small">
        <span><i className="k k-user" /> вы здесь (GPS)</span>
        <span><i className="k k-active" /> текущий участок</span>
        <span><i className="k k-rest" /> дальше по маршруту</span>
        <span><i className="k k-order">1</i> порядок · цвет = товарная группа</span>
        <span>Подложка: {BASEMAPS[basemap].label} · данные © OpenStreetMap</span>
      </div>
      <p className="muted small">
        Корпуса — контуры зданий OpenStreetMap ({HALL_GEO.length} Hall, см. hallGeo.json). Вне комплекса путь до первого Hall —
        пешеходный маршрут OSRM по улицам OSM. Внутри комплекса линии идут по графу проходов официальной схемы, наложенному на
        здания (точность привязки ≈ {Math.round(georef.rmsM)} м). Порядок стендов внутри Hall — по номерам (не GPS).
      </p>
    </div>
  );
}

function addOverlay(m: maplibregl.Map) {
  const empty = FC([]);
  for (const id of ['halls', 'route-rest', 'route-active', 'route-approx', 'user', 'user-acc']) m.addSource(id, { type: 'geojson', data: empty });
  m.addLayer({ id: 'halls-fill', type: 'fill', source: 'halls', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['==', ['get', 'routed'], 1], 0.28, 0.08] } });
  m.addLayer({
    id: 'halls-line',
    type: 'line',
    source: 'halls',
    paint: {
      'line-color': ['case', ['==', ['get', 'current'], 1], '#c8922e', ['==', ['get', 'next'], 1], '#b45309', ['get', 'color']],
      'line-width': ['case', ['==', ['get', 'current'], 1], 4, ['==', ['get', 'next'], 1], 3, 1.2],
      'line-dasharray': ['case', ['==', ['get', 'next'], 1], ['literal', [2, 1]], ['literal', [1, 0]]],
    },
  });
  m.addLayer({ id: 'route-rest', type: 'line', source: 'route-rest', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#c8922e', 'line-width': 3, 'line-opacity': 0.7, 'line-dasharray': [2, 1.5] } });
  m.addLayer({ id: 'route-active', type: 'line', source: 'route-active', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#2563eb', 'line-width': 7, 'line-opacity': 0.95 } });
  m.addLayer({ id: 'route-approx', type: 'line', source: 'route-approx', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#2563eb', 'line-width': 3, 'line-dasharray': [0.5, 2] } });
  m.addLayer({ id: 'user-acc', type: 'fill', source: 'user-acc', paint: { 'fill-color': '#2563eb', 'fill-opacity': 0.14, 'fill-outline-color': '#2563eb' } });
  m.addLayer({ id: 'user', type: 'circle', source: 'user', paint: { 'circle-radius': 8, 'circle-color': '#2563eb', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 } });
}
