import { ALL_GROUPS, POINTS } from './data';

/** Stable colours per "Группа для будущей карты". Unknown groups get a colour from the fallback list. */
const FIXED: Record<string, string> = {
  'YACHT / MARINE': '#0284c7',
  'POWERSPORTS / WINTER': '#ea580c',
  'AUTO / EV': '#16a34a',
  'INNOVATION / OTHER': '#9333ea',
};
const FALLBACK = ['#db2777', '#ca8a04', '#0d9488', '#4f46e5', '#dc2626', '#65a30d'];

function hash(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

export function groupColor(group: string): string {
  return FIXED[group] ?? FALLBACK[hash(group) % FALLBACK.length];
}

export const GROUP_LEGEND = ALL_GROUPS.map((g) => ({
  group: g,
  color: groupColor(g),
  count: POINTS.filter((p) => p.mapGroup === g).length,
})).sort((a, b) => b.count - a.count);
