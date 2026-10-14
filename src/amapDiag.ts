/**
 * Temporary AMap rendering diagnostics: network activity of AMap tile / style / vector resources
 * (fetch, XHR, <img>/<script> errors, Resource Timing) and map state snapshots.
 */
export interface NetEntry {
  t: number;
  kind: 'fetch' | 'xhr' | 'resource' | 'error';
  url: string;
  status: string;
}

const AMAP_HOST = /amap|opnavi|autonavi|alicdn|is\.autonavi|vdata|webrd|webst|wprd/i;
export const net: NetEntry[] = [];
const t0 = performance.now();
let installed = false;

const push = (kind: NetEntry['kind'], url: string, status: string) => {
  if (!AMAP_HOST.test(url)) return;
  net.push({ t: Math.round(performance.now() - t0), kind, url: url.replace(/key=[^&]+/, 'key=…').replace(/jscode=[^&]+/, 'jscode=…'), status });
  if (net.length > 300) net.splice(0, net.length - 300);
};

export function installNetDiag() {
  if (installed) return;
  installed = true;
  const f = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    try {
      const r = await f(input, init);
      push('fetch', url, String(r.status) + (r.type === 'opaque' ? ' opaque' : ''));
      return r;
    } catch (e) {
      push('fetch', url, `FAILED ${(e as Error)?.message ?? ''}`);
      throw e;
    }
  };
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    const u = String(url);
    this.addEventListener('loadend', () => push('xhr', u, this.status ? String(this.status) : 'FAILED (0 / CORS / network)'));
    return (open as any).call(this, method, url, ...rest);
  } as typeof XMLHttpRequest.prototype.open;
  window.addEventListener(
    'error',
    (e) => {
      const el = e.target as HTMLImageElement | HTMLScriptElement | null;
      if (el && el !== (window as unknown) && 'src' in el && el.src) push('error', el.src, `load error <${el.tagName.toLowerCase()}>`);
    },
    true,
  );
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as PerformanceResourceTiming[]) {
        const st = (e as PerformanceResourceTiming & { responseStatus?: number }).responseStatus;
        // Cross-origin entries report 0 bytes without Timing-Allow-Origin — that alone is not an error.
        push('resource', e.name, `${e.initiatorType}${st ? ` ${st}` : ''}`);
      }
    }).observe({ type: 'resource', buffered: true });
  } catch {
    /* Resource Timing unavailable */
  }
}

export function webglSupport(): string {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return 'нет WebGL';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return `${c.getContext('webgl2') ? 'WebGL2' : 'WebGL'}${ext ? ' · ' + gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ''}`;
  } catch (e) {
    return `ошибка WebGL: ${(e as Error).message}`;
  }
}

/** Summary of AMap network activity grouped by host + first path segment. */
export function netSummary(): { key: string; n: number; statuses: string }[] {
  const g = new Map<string, { n: number; st: Set<string> }>();
  for (const e of net) {
    let key = e.url;
    try {
      const u = new URL(e.url);
      key = `${u.host}${u.pathname.split('/').slice(0, 3).join('/')}`;
    } catch {
      /* keep raw */
    }
    const v = g.get(key) ?? { n: 0, st: new Set<string>() };
    v.n++;
    v.st.add(`${e.kind}:${e.status}`);
    g.set(key, v);
  }
  return Array.from(g.entries()).map(([key, v]) => ({ key, n: v.n, statuses: Array.from(v.st).slice(0, 4).join(', ') }));
}
