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

export async function discoverHalls(AMap: AMapNS): Promise<PoiCache> {
  const ps = new AMap.PlaceSearch({ city: '广州', citylimit: true, pageSize: 25, pageIndex: 1, extensions: 'all' });
  const hits = new Map<string, PoiHit>();
  const errors: string[] = [];
  for (const keyword of KEYWORDS) {
    const pois = await new Promise<{ name: string; id: string; type?: string; location: unknown }[]>((resolve) =>
      ps.search(keyword, (status: string, result: { poiList?: { pois?: unknown[] }; info?: string } | string) => {
        if (status === 'complete' && typeof result === 'object') resolve((result.poiList?.pois ?? []) as never);
        else {
          if (status === 'error') errors.push(`${keyword}: ${typeof result === 'string' ? result : result?.info ?? 'error'}`);
          resolve([]);
        }
      }),
    );
    for (const p of pois) {
      if (!p.location || hits.has(p.id)) continue;
      const gcj = lngLatOf(p.location as never);
      if (metersBetween(gcj, COMPLEX_GCJ) > MAX_DIST_M) continue;
      const c = classify(p.name, keyword);
      if (!c) continue;
      hits.set(p.id, { ...c, name: p.name, id: p.id, type: p.type ?? '', gcj, wgs: gcj02ToWgs84(gcj), keyword });
    }
  }
  return { at: new Date().toISOString(), hits: Array.from(hits.values()), queries: KEYWORDS.length, errors };
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
