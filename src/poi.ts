/**
 * Hall discovery through AMap PlaceSearch (POI search). Only coordinates returned by AMap are kept,
 * together with the POI id/name and the query as the source. Nothing is placed by hand.
 */
import type { AMapNS } from './amap';
import { gcj02ToWgs84, metersBetween, wgs84ToGcj02, type LngLat } from './coords';
import type { HallGeo } from './geo';

export type AreaId = 'A' | 'B' | 'C' | 'D';

export interface PoiHit {
  kind: 'hall' | 'area' | 'complex' | 'entrance';
  hall?: string;
  area?: AreaId;
  name: string;
  id: string;
  type: string;
  gcj: LngLat;
  wgs: LngLat;
  keyword: string;
}

export interface PoiCache {
  at: string;
  hits: PoiHit[];
  queries: number;
  errors: string[];
  services?: ServiceProbe[];
}

/** Official hall → area mapping (Phase 1 floor map). */
export const HALL_AREA: Record<string, AreaId> = {
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((h) => [String(h), 'A'])),
  ...Object.fromEntries([9, 10, 11, 12, 13].map((h) => [String(h), 'B'])),
  ...Object.fromEntries([14, 15, 16].map((h) => [String(h), 'C'])),
  ...Object.fromEntries([17, 18, 19, 20, 21].map((h) => [String(h), 'D'])),
};

/** zh.wikipedia coordinate of the complex (WGS-84), used only to reject far-away POIs and as the initial view. */
export const COMPLEX_WGS: LngLat = [113.3553139, 23.1041361];
export const COMPLEX_GCJ: LngLat = wgs84ToGcj02(COMPLEX_WGS);
const MAX_DIST_M = 2500;

const KEYWORDS = [
  '中国进出口商品交易会展馆',
  '广交会展馆',
  'Canton Fair Complex',
  '中国进出口商品交易会展馆A区',
  '中国进出口商品交易会展馆B区',
  '中国进出口商品交易会展馆C区',
  '中国进出口商品交易会展馆D区',
  ...Array.from({ length: 21 }, (_, i) => `广交会展馆${i + 1}号馆`),
];

export function classify(name: string, keyword: string): Omit<PoiHit, 'name' | 'id' | 'type' | 'gcj' | 'wgs' | 'keyword'> | null {
  const area = (name.match(/([ABCD])\s*区/i)?.[1] ?? name.match(/(?:Area|Zone)\s*([ABCD])\b/i)?.[1])?.toUpperCase() as AreaId | undefined;
  const hallNum = name.match(/(\d{1,2})(?:\.\d)?\s*号?\s*(?:展)?馆/)?.[1] ?? name.match(/Hall\s*(\d{1,2})/i)?.[1];
  const isComplex = /广交会|进出口商品交易会|Canton Fair/i.test(name + keyword);
  if (!isComplex) return null;
  // Entrances: 「N号门」, 入口, Gate. (Not 出口 — it is part of 进出口 in the complex name.)
  if (/\d+\s*号\s*门|入口|\bGate\b|Entrance/i.test(name)) return { kind: 'entrance', area };
  if (hallNum && HALL_AREA[String(Number(hallNum))]) {
    const hall = String(Number(hallNum));
    if (area && HALL_AREA[hall] !== area) return null; // contradicts the official layout
    return { kind: 'hall', hall, area: HALL_AREA[hall] };
  }
  if (area) return { kind: 'area', area };
  return { kind: 'complex' };
}

function lngLatOf(loc: { lng?: number; lat?: number; getLng?: () => number; getLat?: () => number }): LngLat {
  return [loc.lng ?? loc.getLng!(), loc.lat ?? loc.getLat!()];
}

type RawPoi = { name: string; id: string; type?: string; location: unknown };
export type ServiceName = 'PlaceSearch' | 'AutoComplete' | 'Geocoder' | 'Walking';
export interface ServiceProbe {
  service: ServiceName;
  ok: boolean;
  info: string;
}

/** Calls an AMap service with a callback; resolves on timeout too (some errors never call back). */
function call<T>(run: (cb: (status: string, result: T) => void) => void, ms = 8000): Promise<{ status: string; result: T | string }> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ status: 'timeout', result: 'нет ответа' }), ms);
    try {
      run((status, result) => {
        clearTimeout(t);
        resolve({ status, result });
      });
    } catch (e) {
      clearTimeout(t);
      resolve({ status: 'error', result: (e as Error).message });
    }
  });
}

const infoOf = (status: string, result: unknown) =>
  status === 'complete' ? 'OK' : status === 'no_data' ? 'нет данных' : typeof result === 'string' ? result : String((result as { info?: string })?.info ?? status);

const DENIED = /INSUFFICIENT_PRIVILEGES|INVALID_USER|USERKEY|SERVICE_NOT|NOT_AVAILABLE|DAILY_QUERY|ACCESS_TOO|UNKNOWN_ERROR|timeout|нет ответа/i;

/**
 * Hall coordinates from whatever AMap service the key is allowed to use:
 * PlaceSearch first (one probe query — if it is denied the other queries are skipped), then AutoComplete tips
 * (they carry coordinates), Geocoder for the complex itself, and a Walking probe. Only returned coordinates are kept.
 */
export async function discoverHalls(AMap: AMapNS): Promise<PoiCache> {
  const hits = new Map<string, PoiHit>();
  const errors: string[] = [];
  const services: ServiceProbe[] = [];
  let queries = 0;
  const add = (p: RawPoi, keyword: string) => {
    if (!p.location || typeof p.location === 'string' || hits.has(p.id || p.name)) return;
    const gcj = lngLatOf(p.location as never);
    if (!Number.isFinite(gcj[0]) || metersBetween(gcj, COMPLEX_GCJ) > MAX_DIST_M) return;
    const c = classify(p.name, keyword);
    if (!c) return;
    hits.set(p.id || p.name, { ...c, name: p.name, id: p.id || '', type: p.type ?? '', gcj, wgs: gcj02ToWgs84(gcj), keyword });
  };

  // 1) PlaceSearch
  const ps = new AMap.PlaceSearch({ city: '广州', citylimit: true, pageSize: 25, pageIndex: 1, extensions: 'all' });
  const psRun = (k: string) => call<{ poiList?: { pois?: RawPoi[] } }>((cb) => ps.search(k, cb));
  const probe = await psRun(KEYWORDS[1]);
  queries++;
  const psOk = probe.status === 'complete' || probe.status === 'no_data';
  services.push({ service: 'PlaceSearch', ok: psOk, info: infoOf(probe.status, probe.result) });
  if (psOk) {
    if (typeof probe.result === 'object') (probe.result.poiList?.pois ?? []).forEach((p) => add(p, KEYWORDS[1]));
    for (const k of KEYWORDS.filter((x) => x !== KEYWORDS[1])) {
      const r = await psRun(k);
      queries++;
      if (r.status === 'complete' && typeof r.result === 'object') (r.result.poiList?.pois ?? []).forEach((p) => add(p, k));
      else if (r.status !== 'no_data') errors.push(`PlaceSearch «${k}»: ${infoOf(r.status, r.result)}`);
    }
  }

  // 2) AutoComplete (input tips with coordinates)
  if (AMap.AutoComplete) {
    const ac = new AMap.AutoComplete({ city: '广州', citylimit: true });
    const acRun = (k: string) => call<{ tips?: RawPoi[] }>((cb) => ac.search(k, cb));
    const r0 = await acRun(KEYWORDS[1]);
    queries++;
    const acOk = r0.status === 'complete' || r0.status === 'no_data';
    services.push({ service: 'AutoComplete', ok: acOk, info: infoOf(r0.status, r0.result) });
    if (acOk) {
      if (typeof r0.result === 'object') (r0.result.tips ?? []).forEach((p) => add(p, KEYWORDS[1]));
      for (const k of KEYWORDS.filter((x) => x !== KEYWORDS[1])) {
        const r = await acRun(k);
        queries++;
        if (r.status === 'complete' && typeof r.result === 'object') (r.result.tips ?? []).forEach((p) => add(p, k));
        else if (r.status !== 'no_data' && DENIED.test(infoOf(r.status, r.result))) break;
      }
    }
  } else services.push({ service: 'AutoComplete', ok: false, info: 'плагин не загружен' });

  // 3) Geocoder — complex level only (addresses, not halls)
  if (AMap.Geocoder) {
    const gc = new AMap.Geocoder({ city: '广州' });
    const r = await call<{ geocodes?: { location: unknown; formattedAddress?: string }[] }>((cb) => gc.getLocation('中国进出口商品交易会展馆', cb));
    queries++;
    services.push({ service: 'Geocoder', ok: r.status === 'complete' || r.status === 'no_data', info: infoOf(r.status, r.result) });
  } else services.push({ service: 'Geocoder', ok: false, info: 'плагин не загружен' });

  // 4) Walking probe between the two Line 8 stations next to the complex (public coordinates).
  if (AMap.Walking) {
    const w = new AMap.Walking({ hideMarkers: true });
    const a = wgs84ToGcj02([113.35145, 23.10123]);
    const b = wgs84ToGcj02([113.36117, 23.10104]);
    const r = await call((cb) => w.search(new AMap.LngLat(a[0], a[1]), new AMap.LngLat(b[0], b[1]), cb));
    services.push({ service: 'Walking', ok: r.status === 'complete', info: infoOf(r.status, r.result) });
  }

  for (const sv of services) if (!sv.ok) errors.push(`${sv.service}: ${sv.info}`);
  return { at: new Date().toISOString(), hits: Array.from(hits.values()), queries, errors, services };
}

/** One record per hall: the POI whose name names the hall most directly. */
export function hallHits(cache: PoiCache | null): Map<string, PoiHit> {
  const m = new Map<string, PoiHit>();
  for (const h of cache?.hits ?? []) {
    if (h.kind !== 'hall' || !h.hall) continue;
    const prev = m.get(h.hall);
    if (!prev || h.name.length < prev.name.length) m.set(h.hall, h);
  }
  return m;
}

export function areaHits(cache: PoiCache | null): Map<AreaId, PoiHit> {
  const m = new Map<AreaId, PoiHit>();
  for (const h of cache?.hits ?? []) if (h.kind === 'area' && h.area && !m.has(h.area)) m.set(h.area, h);
  return m;
}

/** hallGeo.json records from AMap POIs (WGS-84; AMap GCJ-02 kept in the source text). */
export function toHallGeo(cache: PoiCache | null): HallGeo[] {
  return Array.from(hallHits(cache).values()).map((h) => ({
    hall: h.hall!,
    area: h.area ?? HALL_AREA[h.hall!],
    lat: Number(h.wgs[1].toFixed(7)),
    lng: Number(h.wgs[0].toFixed(7)),
    polygon: [],
    accuracy: 'centroid',
    source: `AMap POI ${h.id} «${h.name}» (поиск «${h.keyword}»), GCJ-02 ${h.gcj[0].toFixed(6)},${h.gcj[1].toFixed(6)} → WGS-84`,
  }));
}

const KEY = 'altiora-amap-poi-v1';
export function loadPoiCache(): PoiCache | null {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) ?? 'null') as PoiCache | null;
    return c && Array.isArray(c.hits) ? c : null;
  } catch {
    return null;
  }
}
export function savePoiCache(c: PoiCache) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}
