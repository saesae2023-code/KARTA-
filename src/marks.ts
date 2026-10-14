/**
 * Hall coordinates recorded on site: "📍 Отметить: я в Hall X" stores the real GPS fix as that hall's position.
 * One record per building (floors of a hall share it). Kept in localStorage and exportable to hallGeo.json.
 */
import type { GpsFix } from './useGps';
import type { HallGeo } from './geo';
import { HALL_AREA } from './poi';
import { nodeOfHall } from './venue';

/** GPS fixes worse than this are not accepted as a hall coordinate. */
export const MAX_MARK_ACC_M = 60;

const KEY = 'altiora-hall-marks-v1';

export function loadMarks(): HallGeo[] {
  try {
    const m = JSON.parse(localStorage.getItem(KEY) ?? '[]') as HallGeo[];
    return Array.isArray(m) ? m.filter((x) => x && typeof x.lat === 'number' && typeof x.lng === 'number') : [];
  } catch {
    return [];
  }
}

export function saveMarks(m: HallGeo[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* ignore */
  }
}

export function makeMark(hall: string, fix: GpsFix): HallGeo {
  const b = nodeOfHall(hall);
  const at = new Date(fix.ts || Date.now());
  return {
    hall: b,
    area: HALL_AREA[b] ?? '?',
    lat: Number(fix.lat.toFixed(7)),
    lng: Number(fix.lon.toFixed(7)),
    polygon: [],
    accuracy: 'gps_on_site',
    source: `GPS на месте (Hall ${hall}, ±${Math.round(fix.acc)} м, ${at.toLocaleString('ru-RU')}), WGS-84`,
  };
}

/** Replace the record of the same building. */
export function upsertMark(marks: HallGeo[], m: HallGeo): HallGeo[] {
  return [...marks.filter((x) => x.hall !== m.hall), m];
}
