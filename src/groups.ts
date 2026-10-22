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

/**
 * Phase 2 has many detailed groups («MARINE / WALL PANELS», «SANITARY / BATHROOM», …): they are
 * coloured and summarised by family — the first part of the name. Phase 1 groups are all in FIXED.
 */
const FAMILY: Record<string, string> = {
  MARINE: '#0284c7',
  SANITARY: '#0d9488',
  BUILDING: '#ca8a04',
  COMMERCIAL: '#9333ea',
  GLASS: '#4f46e5',
  WATCHES: '#db2777',
  PREFAB: '#16a34a',
  INTERNATIONAL: '#64748b',
};

/** Legend key of a group: the group itself (Phase 1) or its family — the first word (MARINE, SANITARY, COMMERCIAL, …). */
export function legendKey(group: string): string {
  if (FIXED[group]) return group;
  return group.trim().split(/[\s/]+/)[0];
}

export function groupColor(group: string): string {
  const key = legendKey(group);
  return FIXED[group] ?? FAMILY[key] ?? FALLBACK[hash(key) % FALLBACK.length];
}

export const LEGEND_KEYS: string[] = Array.from(new Set(ALL_GROUPS.map(legendKey)));

export const GROUP_LEGEND = LEGEND_KEYS.map((k) => ({
  group: k,
  color: groupColor(ALL_GROUPS.find((g) => legendKey(g) === k)!),
  count: POINTS.filter((p) => legendKey(p.mapGroup) === k).length,
})).sort((a, b) => b.count - a.count);
