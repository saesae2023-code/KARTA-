/**
 * AMap (高德) JS API 2.0 loader.
 *
 * Environment (never hard-coded):
 *   VITE_AMAP_KEY            — Web端(JS API) key from console.amap.com (public, restricted to your domain).
 *   VITE_AMAP_SECURITY_CODE  — 安全密钥 for local development only (plain mode).
 *   (production)             — leave VITE_AMAP_SECURITY_CODE empty and set AMAP_SECURITY_CODE on Vercel:
 *                              requests go through the /_AMapService proxy (api/amap.ts), which appends the key
 *                              server-side, as recommended by the AMap security documentation.
 */
import AMapLoader from '@amap/amap-jsapi-loader';

export type AMapNS = any;

declare global {
  interface Window {
    _AMapSecurityConfig?: { securityJsCode?: string; serviceHost?: string };
  }
}

export const AMAP_KEY: string = (import.meta.env.VITE_AMAP_KEY as string | undefined)?.trim() ?? '';
const SECURITY_CODE: string = (import.meta.env.VITE_AMAP_SECURITY_CODE as string | undefined)?.trim() ?? '';

export const AMAP_PLUGINS = ['AMap.Walking', 'AMap.PlaceSearch', 'AMap.Scale'];

let loading: Promise<AMapNS> | null = null;

export function loadAMap(): Promise<AMapNS> {
  if (!AMAP_KEY) return Promise.reject(new Error('NO_KEY'));
  if (!loading) {
    window._AMapSecurityConfig = SECURITY_CODE
      ? { securityJsCode: SECURITY_CODE }
      : { serviceHost: `${window.location.origin}/_AMapService` };
    loading = AMapLoader.load({ key: AMAP_KEY, version: '2.0', plugins: AMAP_PLUGINS }).catch((e: unknown) => {
      loading = null;
      throw e;
    });
  }
  return loading;
}
