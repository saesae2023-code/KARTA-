/**
 * WGS-84 (GPS) ⇄ GCJ-02 (AMap / 高德) conversion — the standard public "China offset" formula.
 * Browser geolocation returns WGS-84; AMap maps, POIs and AMap.Walking use GCJ-02.
 */
const A = 6378245.0;
const EE = 0.00669342162296594323;
const PI = Math.PI;

export type LngLat = [number, number];

const outOfChina = (lng: number, lat: number) => lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;

function tLat(x: number, y: number) {
  let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3;
  r += ((20 * Math.sin(y * PI) + 40 * Math.sin((y / 3) * PI)) * 2) / 3;
  r += ((160 * Math.sin((y / 12) * PI) + 320 * Math.sin((y * PI) / 30)) * 2) / 3;
  return r;
}

function tLng(x: number, y: number) {
  let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3;
  r += ((20 * Math.sin(x * PI) + 40 * Math.sin((x / 3) * PI)) * 2) / 3;
  r += ((150 * Math.sin((x / 12) * PI) + 300 * Math.sin((x / 30) * PI)) * 2) / 3;
  return r;
}

export function wgs84ToGcj02([lng, lat]: LngLat): LngLat {
  if (outOfChina(lng, lat)) return [lng, lat];
  let dLat = tLat(lng - 105, lat - 35);
  let dLng = tLng(lng - 105, lat - 35);
  const radLat = (lat / 180) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
  dLng = (dLng * 180) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
  return [lng + dLng, lat + dLat];
}

/** Inverse by fixed-point iteration (error < 1 cm after a few steps). */
export function gcj02ToWgs84(g: LngLat): LngLat {
  let w: LngLat = [g[0], g[1]];
  for (let i = 0; i < 6; i++) {
    const t = wgs84ToGcj02(w);
    w = [w[0] - (t[0] - g[0]), w[1] - (t[1] - g[1])];
  }
  return w;
}

export function metersBetween(a: LngLat, b: LngLat): number {
  return Math.hypot((a[0] - b[0]) * 111320 * Math.cos((a[1] * PI) / 180), (a[1] - b[1]) * 110574);
}
