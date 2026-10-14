/**
 * Russian display labels for halls, floors, zones and booths. Display only — internal values ("15.2",
 * "15.2D14-15") and routing are unchanged.
 */
import { NODE_BY_ID, nodeOfHall, splitHall } from './venue';

export type ZoneId = 'A' | 'B' | 'C' | 'D';

export function zoneOf(hall: string): ZoneId | null {
  return (NODE_BY_ID.get(nodeOfHall(hall))?.area as ZoneId | undefined) ?? null;
}

export const zoneLabel = (z: ZoneId | null) => (z ? `Зона ${z}` : 'Зона ?');

export const isOutdoor = (hall: string) => splitHall(hall).floor === 0;

/** "Павильон 15" / "Открытая площадка 12". */
export function buildingLabel(hall: string): string {
  const { building } = splitHall(hall);
  return isOutdoor(hall) ? `Открытая площадка ${building}` : `Павильон ${building}`;
}

export const floorLabel = (f: number) => `${f} этаж`;

/** "Павильон 15 · 2 этаж" / "Открытая площадка 12". */
export function hallLabel(hall: string): string {
  const { floor } = splitHall(hall);
  return isOutdoor(hall) || !floor ? buildingLabel(hall) : `${buildingLabel(hall)} · ${floorLabel(floor)}`;
}

/** Compact: "П.15 · 2 эт." / "Площадка 12". */
export function hallShort(hall: string): string {
  const { building, floor } = splitHall(hall);
  return isOutdoor(hall) ? `Площадка ${building}` : `П.${building} · ${floor} эт.`;
}

/** "15.2D14-15" → "D14-15"; "EV 8.1E17-18" → "E17-18 (EV)". */
export function boothLabel(booth: string): string {
  const ev = /^EV\s*/i.test(booth);
  const rest = booth.replace(/^EV\s*/i, '').replace(/^\d{1,2}\.\d\s*/, '').trim();
  return (rest || booth) + (ev ? ' (EV)' : '');
}

export const boothsLabel = (booths: string[]) => booths.map(boothLabel).join(', ');

/** "Зона C → Павильон 15 → 2 этаж → стенд D33". */
export function pathLine(hall: string, booths: string[]): string {
  const { floor } = splitHall(hall);
  const parts = [zoneLabel(zoneOf(hall)), buildingLabel(hall)];
  if (!isOutdoor(hall) && floor) parts.push(floorLabel(floor));
  if (booths.length) parts.push(`стенд ${boothsLabel(booths)}`);
  return parts.join(' → ');
}

export const STREETS = {
  xingang: { ru: 'ул. Синган-Дунлу', en: 'Xingang Donglu', zh: '新港东路' },
  yuejiang: { ru: 'ул. Юэцзян-Чжунлу', en: 'Yuejiang Zhonglu', zh: '阅江中路' },
  xilu: { ru: 'ул. Чжаньчан-Силу', en: 'Zhanchang Xilu', zh: '' },
  zhonglu: { ru: 'ул. Чжаньчан-Чжунлу', en: 'Zhanchang Zhonglu', zh: '' },
  donglu: { ru: 'ул. Чжаньчан-Дунлу', en: 'Zhanchang Donglu', zh: '' },
};

/** How to get from one zone to another along the complex walkways (official layout topology). */
function zoneTransfer(from: ZoneId, to: ZoneId): string[] {
  if (from === to) return [];
  const north = (z: ZoneId) => z === 'A' || z === 'B';
  if (from === 'D' && to === 'A') return ['Перейдите из Зоны D в Зону A (переход D ↔ A)'];
  if (from === 'A' && to === 'D') return ['Перейдите из Зоны A в Зону D (переход D ↔ A)'];
  if (north(from) && north(to)) return [`Идите по Pearl Promenade в Зону ${to}`];
  if (from === 'D' && to === 'B') return ['Через Зону A по Pearl Promenade идите в Зону B'];
  if (from === 'B' && to === 'D') return ['По Pearl Promenade через Зону A идите в Зону D'];
  if (to === 'C') return [`${from === 'D' ? 'Через Зону A ' : ''}идите к Middle Platform (между Зонами A и B)`, `Перейдите ул. Синган-Дунлу (Xingang Donglu) по переходу в Зону C`];
  // from C to the north side
  return ['Вернитесь по переходу через ул. Синган-Дунлу к Middle Platform', to === 'D' ? 'По Pearl Promenade через Зону A идите в Зону D' : `Идите по Pearl Promenade в Зону ${to}`];
}

export interface From {
  /** Hall the user is in (e.g. "15.2"), or a building only ("15") when known from GPS. */
  hall: string | null;
  /** User is outside the complex (GPS). */
  outside?: boolean;
  /** Zone the user is in (inside the complex, not in a pavilion — e.g. on the Pearl Promenade). */
  zone?: ZoneId | null;
}

/** Step-by-step "Куда идти" for the next point. */
export function directions(from: From, hall: string, booths: string[]): string[] {
  const z = zoneOf(hall);
  const { building, floor } = splitHall(hall);
  const outdoor = isOutdoor(hall);
  const out: string[] = [];
  const fromB = from.hall ? nodeOfHall(from.hall.includes('.') ? from.hall : `${from.hall}.1`) : null;
  const fromFloor = from.hall && from.hall.includes('.') ? splitHall(from.hall).floor : null;
  const sameBuilding = !!fromB && !outdoor && fromB === String(building);
  const floorLine = () => {
    if (outdoor || !floor) return;
    if (fromFloor !== null && sameBuilding) {
      if (floor > fromFloor) out.push(`Поднимитесь на ${floorLabel(floor)}`);
      else if (floor < fromFloor) out.push(`Спуститесь на ${floorLabel(floor)}`);
    } else out.push(floor > 1 ? `Поднимитесь на ${floorLabel(floor)}` : from.hall || from.zone ? floorLabel(1) : `${floorLabel(1)} (вход с улицы)`);
  };
  if (sameBuilding) {
    out.push(fromFloor === floor ? `Вы в нужном павильоне — ${buildingLabel(hall)}, ${floorLabel(floor)}` : `Вы в павильоне ${building}`);
    floorLine();
  } else if (fromB && !from.outside) {
    const fz = zoneOf(`${fromB}.1`) ?? zoneOf(`${fromB}.0`);
    out.push(`Выйдите из ${isOutdoor(from.hall!) ? 'открытой площадки' : 'павильона'} ${fromB}`);
    if (fz && z && fz !== z) out.push(...zoneTransfer(fz, z));
    out.push(`${outdoor ? 'Перейдите на' : 'Перейдите в'} ${outdoor ? `открытую площадку ${building}` : `павильон ${building}`}`);
    floorLine();
  } else if (from.zone && !from.outside && z) {
    out.push(from.zone === z ? `Вы в ${zoneLabel(z).replace('Зона', 'Зоне')}` : `Вы в ${zoneLabel(from.zone).replace('Зона', 'Зоне')}`);
    if (from.zone !== z) out.push(...zoneTransfer(from.zone, z));
    out.push(`${outdoor ? 'Перейдите на' : 'Войдите в'} ${outdoor ? `открытую площадку ${building}` : `павильон ${building}`}`);
    floorLine();
  } else {
    out.push(`Идите к ${zoneLabel(z).replace('Зона', 'Зоне')}`);
    out.push(z === 'C' ? 'Вход в Зону C — со стороны ул. Синган-Дунлу (Xingang Donglu)' : `Вход со стороны ул. Синган-Дунлу (Xingang Donglu) — вход в Зону ${z}`);
    out.push(buildingLabel(hall));
    floorLine();
  }
  if (booths.length) out.push(`Стенд ${boothsLabel(booths)}`);
  return out;
}
