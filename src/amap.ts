/**
 * AMap Overseas Platform — JS API 2.0 loader (endpoint sg-webapi.opnavi.com, service type oversea_sg).
 *
 * Environment (build time, Vercel → Environment Variables, then Redeploy):
 *   VITE_AMAP_KEY           — JS API key of the overseas platform.
 *   VITE_AMAP_SECURITY_KEY  — security code (securityJsCode).
 * Security config is set on window BEFORE the script is requested, as the platform requires.
 */

import { installNetDiag } from './amapDiag';

export type AMapNS = any; // eslint-disable-line @typescript-eslint/no-explicit-any

declare global {
  interface Window {
    AMap?: AMapNS;
    _AMapSecurityConfig?: { securityJsCode?: string };
    _AMapServiceConfig?: { type: string };
  }
}

export const AMAP_ENDPOINT = 'https://sg-webapi.opnavi.com/maps';
export const AMAP_KEY: string = (import.meta.env.VITE_AMAP_KEY ?? '').trim();
const SECURITY_KEY: string = (import.meta.env.VITE_AMAP_SECURITY_KEY ?? import.meta.env.VITE_AMAP_SECURITY_CODE ?? '').trim();
export const AMAP_PLUGINS = ['AMap.Walking', 'AMap.PlaceSearch', 'AMap.AutoComplete', 'AMap.Geocoder', 'AMap.Scale'];
export const MAP_OPTIONS = { zoom: 16, showOversea: true, center: [113.354, 23.103] as [number, number] };

/** Basemap rendering mode (temporary switch while diagnosing the blank basemap). */
export interface RenderMode {
  viewMode: '2D' | '3D';
  layer: 'vector' | 'raster' | 'satellite';
}
// Official AMap Overseas example uses viewMode '3D'.
export const DEFAULT_RENDER: RenderMode = { viewMode: '3D', layer: 'vector' };
const RENDER_KEY = 'altiora-amap-render';
export function loadRender(): RenderMode {
  try {
    const r = JSON.parse(localStorage.getItem(RENDER_KEY) ?? 'null') as RenderMode | null;
    if (r && (r.viewMode === '2D' || r.viewMode === '3D') && ['vector', 'raster', 'satellite'].includes(r.layer)) return r;
  } catch {
    /* ignore */
  }
  return DEFAULT_RENDER;
}
export function saveRender(r: RenderMode) {
  try {
    localStorage.setItem(RENDER_KEY, JSON.stringify(r));
  } catch {
    /* ignore */
  }
}

/** Explicit base layers for the chosen mode. */
export function baseLayers(AMap: AMapNS, layer: RenderMode['layer']): AMapNS[] {
  if (layer === 'raster') return [new AMap.TileLayer()];
  if (layer === 'satellite') return [new AMap.TileLayer.Satellite(), new AMap.TileLayer.RoadNet()];
  return [typeof AMap.createDefaultLayer === 'function' ? AMap.createDefaultLayer() : new AMap.TileLayer()];
}

export const mapTiming = { completeAt: 0, createdAt: 0 };

/** Normalised AMap error for the UI — never "[object Object]". */
export interface AMapDiag {
  stage: 'config' | 'script' | 'global' | 'plugins' | 'map' | 'service';
  errcode: string;
  errmsg: string;
  errdetail: string;
  endpoint: string;
  hasAMap: boolean;
  keySet: boolean;
  securitySet: boolean;
  serviceType: string;
  console: string[];
}

const mask = (k: string) => (k.length > 8 ? `${k.slice(0, 4)}…${k.slice(-4)}` : k ? '…' : '(пусто)');
export const endpointUrl = (showKey = false) => `${AMAP_ENDPOINT}?v=2.0&key=${showKey ? AMAP_KEY : mask(AMAP_KEY)}`;

/** Messages AMap prints while loading (e.g. "<AMap JSAPI> KEY异常 …") — the only place some key errors appear. */
const captured: string[] = [];
function captureConsole(): () => void {
  const orig = { error: console.error, warn: console.warn, log: console.log };
  const wrap = (fn: (...a: unknown[]) => void) => (...a: unknown[]) => {
    const text = a.map((x) => (typeof x === 'string' ? x : safeJson(x))).join(' ');
    if (/amap|jsapi|key|密钥|错误|INVALID|USERKEY|SCODE|DOMAIN|QUOTA|errcode|infocode/i.test(text)) captured.push(text.slice(0, 300));
    fn.apply(console, a);
  };
  console.error = wrap(orig.error);
  console.warn = wrap(orig.warn);
  console.log = wrap(orig.log);
  return () => Object.assign(console, orig);
}

function safeJson(x: unknown): string {
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}

/** Turn anything AMap may throw / return (Error, Event, {errcode,…}, {info, infocode}, string) into fields. */
export function describe(e: unknown, stage: AMapDiag['stage']): AMapDiag {
  let errcode = '';
  let errmsg = '';
  let errdetail = '';
  if (e instanceof Error) {
    errcode = (e as Error & { code?: string }).code ?? e.name;
    errmsg = e.message;
  } else if (typeof Event !== 'undefined' && e instanceof Event) {
    errcode = 'SCRIPT_LOAD_FAILED';
    errmsg = `Скрипт ${AMAP_ENDPOINT} не загрузился (${e.type})`;
    errdetail = 'Сеть, блокировщик или неверный адрес endpoint.';
  } else if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    errcode = String(o.errcode ?? o.infocode ?? o.code ?? o.status ?? '');
    errmsg = String(o.errmsg ?? o.info ?? o.message ?? o.msg ?? '');
    errdetail = String(o.errdetail ?? o.detail ?? '');
    if (!errcode && !errmsg) errdetail = safeJson(o);
  } else if (e !== undefined && e !== null) {
    errmsg = String(e);
  }
  return {
    stage,
    errcode: errcode || '—',
    errmsg: errmsg || '—',
    errdetail: errdetail || '—',
    endpoint: endpointUrl(),
    hasAMap: typeof window !== 'undefined' && !!window.AMap,
    keySet: !!AMAP_KEY,
    securitySet: !!SECURITY_KEY,
    serviceType: window._AMapServiceConfig?.type ?? '—',
    console: captured.slice(-6),
  };
}

let loading: Promise<AMapNS> | null = null;

export function loadAMap(timeoutMs = 20000): Promise<AMapNS> {
  if (!AMAP_KEY) return Promise.reject(describe({ errcode: 'NO_KEY', errmsg: 'VITE_AMAP_KEY не задан в сборке' }, 'config'));
  if (loading) return loading;
  loading = new Promise<AMapNS>((resolve, reject) => {
    // Must be set before the script request.
    installNetDiag();
    if (SECURITY_KEY) window._AMapSecurityConfig = { securityJsCode: SECURITY_KEY };
    window._AMapServiceConfig = { type: 'oversea_sg' };
    const restore = captureConsole();
    const fail = (e: unknown, stage: AMapDiag['stage']) => {
      restore();
      loading = null;
      reject(describe(e, stage));
    };
    if (window.AMap) return finish(window.AMap);
    const s = document.createElement('script');
    s.src = endpointUrl(true);
    s.async = true;
    s.onerror = (ev) => fail(ev, 'script');
    s.onload = () => {
      if (!window.AMap) return fail({ errcode: 'AMAP_UNDEFINED', errmsg: 'Скрипт загружен, но window.AMap не определён', errdetail: captured.slice(-3).join(' | ') }, 'global');
      finish(window.AMap);
    };
    const timer = setTimeout(() => fail({ errcode: 'TIMEOUT', errmsg: `Нет ответа ${timeoutMs / 1000} с` }, window.AMap ? 'plugins' : 'script'), timeoutMs);
    document.head.appendChild(s);

    function finish(AMap: AMapNS) {
      try {
        AMap.plugin(AMAP_PLUGINS, () => {
          clearTimeout(timer);
          restore();
          resolve(AMap);
        });
      } catch (e) {
        clearTimeout(timer);
        fail(e, 'plugins');
      }
    }
  });
  return loading;
}

/** Create the map and wait for its 'complete' event (key / domain errors surface here). */
export function createMap(AMap: AMapNS, container: HTMLElement, render: RenderMode = DEFAULT_RENDER, timeoutMs = 15000): Promise<AMapNS> {
  return new Promise((resolve, reject) => {
    const restore = captureConsole();
    let map: AMapNS;
    try {
      mapTiming.createdAt = performance.now();
      mapTiming.completeAt = 0;
      map = new AMap.Map(container, { ...MAP_OPTIONS, viewMode: render.viewMode, layers: baseLayers(AMap, render.layer) });
    } catch (e) {
      restore();
      return reject(describe(e, 'map'));
    }
    const timer = setTimeout(() => {
      restore();
      reject(describe({ errcode: 'MAP_NOT_COMPLETE', errmsg: 'Карта создана, но тайлы не загрузились', errdetail: captured.slice(-3).join(' | ') || 'Проверьте ключ, whitelist домена и securityJsCode.' }, 'map'));
    }, timeoutMs);
    map.on('complete', () => {
      clearTimeout(timer);
      restore();
      mapTiming.completeAt = performance.now();
      // The container may have been laid out after creation: make AMap re-measure it.
      map.resize?.();
      resolve(map);
    });
  });
}

/** Service (Walking / PlaceSearch) error result → readable text. */
export function serviceError(status: string, result: unknown): string {
  const d = describe(typeof result === 'string' ? { errmsg: result } : result, 'service');
  return `${status}: ${[d.errcode, d.errmsg, d.errdetail].filter((x) => x && x !== '—').join(' · ') || 'нет данных'}`;
}
