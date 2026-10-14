/**
 * Georeference between the official venue plan (units, see venue.ts) and WGS-84 GPS coordinates.
 *
 * Default anchors: the two Line 8 metro stations under Xingang Donglu (public coordinates):
 *   Xingangdong (next to Areas A / D) and Pazhou (next to Areas B / C).
 * Their exact x position along the road relative to the halls is estimated, so the default georeference is
 * APPROXIMATE (≈ ±100 m). On site the user refines it with "Я в Hall X" — each confirmation with a good GPS fix
 * becomes a calibration anchor; with two separated anchors the default ones are no longer used.
 */
import { NODE_BY_ID, BOX_W, ROW_H, ROW_TOP, nodeOfHall, type Pt } from './venue';

export interface Anchor {
  x: number;
  y: number;
  lat: number;
  lon: number;
  kind: 'default' | 'calib';
  label: string;
  acc?: number;
  at?: string;
}

const LAT0 = 23.1012;
const LON0 = 113.3515;
const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180);

export const DEFAULT_ANCHORS: Anchor[] = [
  { x: 5.5, y: 5.8, lat: 23.10123, lon: 113.35145, kind: 'default', label: 'Метро Xingangdong (Line 8)' },
  { x: 15.0, y: 5.8, lat: 23.10104, lon: 113.36117, kind: 'default', label: 'Метро Pazhou (Line 8)' },
];

type C = { re: number; im: number };
const toEN = (lat: number, lon: number): C => ({ re: (lon - LON0) * M_PER_DEG_LON, im: (lat - LAT0) * M_PER_DEG_LAT });
const fromEN = (w: C) => ({ lat: LAT0 + w.im / M_PER_DEG_LAT, lon: LON0 + w.re / M_PER_DEG_LON });
// Venue y grows southwards; complex plane imaginary axis = north.
const toZ = (p: Pt): C => ({ re: p.x, im: -p.y });
const mul = (a: C, b: C): C => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const sub = (a: C, b: C): C => ({ re: a.re - b.re, im: a.im - b.im });
const add = (a: C, b: C): C => ({ re: a.re + b.re, im: a.im + b.im });
const conj = (a: C): C => ({ re: a.re, im: -a.im });
const div = (a: C, b: C): C => {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};

export type GeoQuality = 'approx' | 'partial' | 'calibrated';

export interface Georef {
  quality: GeoQuality;
  /** Metres per venue unit. */
  mPerUnit: number;
  toVenue: (lat: number, lon: number) => Pt;
  toLatLon: (p: Pt) => { lat: number; lon: number };
  anchors: Anchor[];
}

/** Weighted least-squares similarity transform (scale, rotation, shift): EN = a·z + b. */
export function fitGeoref(calib: Anchor[]): Georef {
  const spread = calib.length >= 2 && Math.max(...calib.map((c) => Math.hypot(c.x - calib[0].x, c.y - calib[0].y))) >= 1.5;
  const used = spread ? calib : [...DEFAULT_ANCHORS, ...calib];
  const w = (a: Anchor) => (a.kind === 'calib' ? 10 : 1);
  const W = used.reduce((s, a) => s + w(a), 0);
  let zc: C = { re: 0, im: 0 };
  let ec: C = { re: 0, im: 0 };
  for (const a of used) {
    zc = add(zc, { re: (toZ(a).re * w(a)) / W, im: (toZ(a).im * w(a)) / W });
    const e = toEN(a.lat, a.lon);
    ec = add(ec, { re: (e.re * w(a)) / W, im: (e.im * w(a)) / W });
  }
  let num: C = { re: 0, im: 0 };
  let den = 0;
  for (const a of used) {
    const dz = sub(toZ(a), zc);
    const de = sub(toEN(a.lat, a.lon), ec);
    const t = mul(de, conj(dz));
    num = add(num, { re: t.re * w(a), im: t.im * w(a) });
    den += (dz.re * dz.re + dz.im * dz.im) * w(a);
  }
  // With a single anchor location (degenerate), keep the default scale/rotation.
  const a = den > 1e-9 ? { re: num.re / den, im: num.im / den } : { re: 100, im: 0 };
  const b = sub(ec, mul(a, zc));
  return {
    quality: spread ? 'calibrated' : calib.length ? 'partial' : 'approx',
    mPerUnit: Math.hypot(a.re, a.im),
    toVenue: (lat, lon) => {
      const z = div(sub(toEN(lat, lon), b), a);
      return { x: z.re, y: -z.im };
    },
    toLatLon: (p) => fromEN(add(mul(a, toZ(p)), b)),
    anchors: used,
  };
}

/** Centre of a hall's building on the plan (calibration target). */
export function hallCenter(hall: string): Pt | null {
  const n = NODE_BY_ID.get(nodeOfHall(hall));
  if (!n) return null;
  return { x: n.x + BOX_W / 2, y: ROW_TOP[n.row] + ROW_H[n.row] / 2 };
}

export const WALK_M_PER_MIN = 70;
