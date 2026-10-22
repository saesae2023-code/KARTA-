/**
 * Russian display labels for halls, floors, zones and booths. Display only — internal values ("15.2",
 * "15.2D14-15") and routing are unchanged.
 */
import landmarksData from './data/landmarks.json';
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
/** A «booth» that is only a hall code («2.1»): the whole pavilion / zone, no stand number (Phase 2 International Pavilion). */
export const HALL_ONLY = 'весь павильон';

export function boothLabel(booth: string): string {
  if (/^\d{1,2}\.\d$/.test(booth.trim())) return HALL_ONLY;
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
  /** Side of the complex the user approaches from outside (GPS): north = Yuejiang Zhonglu, south = Xingang Donglu. */
  approach?: 'north' | 'south';
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

/** One-line navigation strip, e.g. "Выйдите из павильона 15 → Зона B → Павильон 9 → 3 этаж → C37–38". */
export function compactDirections(from: From, hall: string, booths: string[]): string {
  const z = zoneOf(hall);
  const { building, floor } = splitHall(hall);
  const outdoor = isOutdoor(hall);
  const fromB = from.hall ? nodeOfHall(from.hall.includes('.') ? from.hall : `${from.hall}.1`) : null;
  const fromFloor = from.hall && from.hall.includes('.') ? splitHall(from.hall).floor : null;
  const stand = booths.length ? boothsLabel(booths) : '';
  const parts: string[] = [];
  if (fromB && !outdoor && fromB === String(building)) {
    if (fromFloor !== null && fromFloor !== floor) parts.push(`Вы в павильоне ${building}`, `${floor > fromFloor ? 'наверх' : 'вниз'} на ${floorLabel(floor)}`);
    else parts.push('Вы на месте');
  } else {
    const fromZone = fromB ? zoneOf(`${fromB}.1`) ?? zoneOf(`${fromB}.0`) : from.zone ?? null;
    if (fromB && !from.outside) parts.push(`Выйдите из ${isOutdoor(from.hall!) ? 'площадки' : 'павильона'} ${fromB}`);
    else if (from.outside) parts.push('Вход с ул. Синган-Дунлу');
    if (!fromZone || fromZone !== z) parts.push(zoneLabel(z));
    parts.push(outdoor ? `Площадка ${building}` : `Павильон ${building}`);
    if (!outdoor && floor) parts.push(floorLabel(floor));
  }
  if (stand) parts.push(stand);
  return parts.join(' → ');
}

// ---- step-by-step navigation (display only) --------------------------------


/** Optional real landmarks per pavilion (src/data/landmarks.json). Never synthesised. */
export interface Landmarks {
  entrance?: string;
  route?: string;
  pavilion?: string;
  indoor?: string;
}
const LANDMARKS = landmarksData as Record<string, Landmarks>;

export type NavKind = 'approach' | 'complex' | 'exit' | 'zone' | 'platform' | 'toPavilion' | 'enter' | 'floorUp' | 'floorDown' | 'floorStay' | 'sector' | 'stand' | 'extra';

export interface NavStep {
  text: string;
  sub?: string;
  landmark?: string;
  /** What kind of manoeuvre this is (icon + where on the path it happens). */
  kind?: NavKind;
  /** Target zone of a 'zone' step. */
  zone?: ZoneId;
}

export interface NavPlan {
  /** Where to enter (only when coming from outside / unknown position). */
  entrance?: { label: string; street: string; side: string };
  /** Where the user starts when already inside ("Вы в павильоне 15 · Зона C"). */
  start?: string;
  zone: string;
  pavilion: string;
  floor?: string;
  stand: string;
  shortRoute: string;
  steps: NavStep[];
}

const dash = (s: string) => s.replace(/-/g, '–');
const sectorOf = (booth: string) => boothLabel(booth).match(/^([A-Z]{1,2})\d/)?.[1] ?? null;

/** Street / side of the zone entrance the user approaches (north = Yuejiang Zhonglu, south = Xingang Donglu). */
function entranceFor(z: ZoneId, approach: 'north' | 'south') {
  const north = approach === 'north' && (z === 'A' || z === 'B');
  const st = north ? STREETS.yuejiang : STREETS.xingang;
  return { label: `Вход в Зону ${z}`, street: st.ru, side: north ? 'северная сторона' : 'южная сторона' };
}

export function navPlan(from: From, hall: string, booths: string[]): NavPlan {
  const z = zoneOf(hall) ?? 'A';
  const { building, floor } = splitHall(hall);
  const outdoor = isOutdoor(hall);
  const lm = LANDMARKS[String(building)] ?? {};
  const place = outdoor ? `Открытая площадка ${building}` : `Павильон ${building}`;
  const placeDat = outdoor ? `открытой площадке ${building}` : `Павильону ${building}`;
  const stands = booths.map((b) => dash(boothLabel(b)));
  const fromB = from.hall ? nodeOfHall(from.hall.includes('.') ? from.hall : `${from.hall}.1`) : null;
  const fromFloor = from.hall && from.hall.includes('.') ? splitHall(from.hall).floor : null;
  const fromZone = fromB ? zoneOf(`${fromB}.1`) ?? zoneOf(`${fromB}.0`) : from.zone ?? null;
  const inside = !!fromB || (!!from.zone && !from.outside);
  const samePlace = !!fromB && !outdoor && fromB === String(building);
  const steps: NavStep[] = [];
  const route: string[] = [];
  let entrance: NavPlan['entrance'];
  let start: string | undefined;

  if (samePlace) {
    start = `Вы в павильоне ${building}`;
  } else if (inside) {
    start = fromB ? `Вы в ${isOutdoor(from.hall!) ? 'открытой площадке' : 'павильоне'} ${fromB} · ${zoneLabel(fromZone)}` : `Вы в ${zoneLabel(fromZone).replace('Зона', 'Зоне')}`;
    if (fromB) steps.push({ text: `Выйдите из ${isOutdoor(from.hall!) ? 'открытой площадки' : 'павильона'} ${fromB}`, kind: 'exit' });
    if (fromZone && fromZone !== z) {
      steps.push(...zoneTransferSteps(fromZone, z));
      route.push(zoneLabel(z));
    }
    steps.push({ text: `Следуйте к ${placeDat}`, landmark: lm.route, kind: 'toPavilion' });
  } else {
    entrance = entranceFor(z, from.approach ?? 'south');
    route.push(entrance.label);
    steps.push({ text: `Подойдите ко входу в Зону ${z}`, sub: `Со стороны ${entrance.street}`, landmark: lm.entrance, kind: 'approach' });
    steps.push({ text: 'Войдите на территорию комплекса', sub: `Через вход в Зону ${z}`, kind: 'complex' });
    steps.push({ text: `Двигайтесь в Зону ${z}`, kind: 'zone', zone: z });
    steps.push({ text: `Следуйте к ${placeDat}`, landmark: lm.route, kind: 'toPavilion' });
  }
  route.push(place);
  if (!samePlace) steps.push({ text: `Войдите в ${outdoor ? 'открытую площадку' : 'павильон'} ${building}`, landmark: lm.pavilion, kind: 'enter' });

  if (!outdoor && floor) {
    route.push(floorLabel(floor));
    const cur = samePlace ? fromFloor : 1;
    if (cur === null || cur === floor) steps.push({ text: `Оставайтесь на ${floor} этаже`, kind: 'floorStay' });
    else steps.push({ text: `${floor > cur ? 'Поднимитесь' : 'Спуститесь'} на ${floorLabel(floor)}`, kind: floor > cur ? 'floorUp' : 'floorDown' });
  }
  const sector = booths.length ? sectorOf(booths[0]) : null;
  if (sector) steps.push({ text: `Найдите сектор ${sector}`, sub: 'Буква в номере стенда', landmark: lm.indoor, kind: 'sector' });
  if (stands.length === 1 && stands[0] === HALL_ONLY) {
    steps.push({ text: `Осмотрите ${outdoor ? 'площадку' : 'павильон'} ${building}`, sub: 'Без номера стенда — вся зона', kind: 'stand' });
    route.push(HALL_ONLY);
  } else if (stands.length) {
    steps.push({ text: `Следуйте к ${/[–]/.test(stands[0]) ? 'стендам' : 'стенду'} ${stands[0]}`, kind: 'stand' });
    for (const extra of stands.slice(1)) steps.push({ text: `Дополнительный стенд — ${extra}`, kind: 'extra' });
    route.push(stands.join(' / '));
  }

  return {
    entrance,
    start,
    zone: zoneLabel(z),
    pavilion: place,
    floor: !outdoor && floor ? floorLabel(floor) : undefined,
    stand: stands.join(', '),
    shortRoute: route.join(' → '),
    steps,
  };
}

function zoneTransferSteps(from: ZoneId, to: ZoneId): NavStep[] {
  const north = (q: ZoneId) => q === 'A' || q === 'B';
  const zs = (text: string, zone: ZoneId): NavStep => ({ text, kind: 'zone', zone });
  const platform: NavStep = { text: 'Идите к Middle Platform (между Зонами A и B)', kind: 'platform' };
  if ((from === 'D' && to === 'A') || (from === 'A' && to === 'D')) return [zs(`Перейдите в Зону ${to} по переходу D ↔ A`, to)];
  if (north(from) && north(to)) return [zs(`Идите по Pearl Promenade в Зону ${to}`, to)];
  if (from === 'D' && to === 'B') return [zs('Пройдите через Зону A', 'A'), zs('По Pearl Promenade идите в Зону B', 'B')];
  if (from === 'B' && to === 'D') return [zs('По Pearl Promenade пройдите через Зону A', 'A'), zs('Перейдите в Зону D по переходу D ↔ A', 'D')];
  if (to === 'C') return [...(from === 'D' ? [zs('Перейдите в Зону A по переходу D ↔ A', 'A')] : []), platform, zs('Перейдите ул. Синган-Дунлу по переходу в Зону C', 'C')];
  return [
    { text: 'Идите по переходу через ул. Синган-Дунлу к Middle Platform', kind: 'platform' },
    ...(to === 'D' ? [zs('Через Зону A идите к переходу D ↔ A', 'A'), zs('Перейдите в Зону D', 'D')] : [zs(`Идите по Pearl Promenade в Зону ${to}`, to)]),
  ];
}
