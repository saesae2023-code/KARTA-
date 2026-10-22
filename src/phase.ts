/**
 * Canton Fair phases. Each phase is one dataset imported from its Excel (src/data/phaseN.json,
 * see scripts/import_excel.py). The phase is chosen at startup — `?phase=N` in the URL, else the
 * last choice on this device — and switching reloads the app with that dataset. Visit statuses,
 * route and navigation are kept per phase; pavilion marks (same complex) are shared.
 */
import type { Point } from './types';

export interface Dataset {
  phase: number;
  source: string;
  sheet: string;
  /** Phase dates from the Excel summary («23–27 октября 2026»). */
  dates?: string;
  /** Zone order when there is no GPS / current hall (Excel ROUTE STRATEGY), e.g. ["B","C","D","A"]. */
  defaultAreaOrder?: string[];
  columns: string[];
  points: Point[];
}

const FILES = import.meta.glob<Dataset>('./data/phase*.json', { eager: true, import: 'default' });

export const DATASETS: Map<number, Dataset> = new Map(
  Object.values(FILES)
    .filter((d) => d && Array.isArray(d.points) && d.points.length > 0)
    .map((d) => [d.phase, d]),
);

/** Phases shown in the switcher (a phase without data is shown as unavailable). */
export const KNOWN_PHASES = [1, 2, 3];

const PHASE_KEY = 'altiora-phase';

function pick(): number {
  const fromUrl = Number(new URLSearchParams(location.search).get('phase'));
  if (DATASETS.has(fromUrl)) {
    try {
      localStorage.setItem(PHASE_KEY, String(fromUrl));
    } catch {
      /* not remembered */
    }
    return fromUrl;
  }
  try {
    const saved = Number(localStorage.getItem(PHASE_KEY));
    if (DATASETS.has(saved)) return saved;
  } catch {
    /* ignore */
  }
  return DATASETS.has(1) ? 1 : Math.min(...DATASETS.keys());
}

export const PHASE = pick();
export const DATASET = DATASETS.get(PHASE)!;

/** localStorage key for per-phase state; Phase 1 keeps its original keys so saved progress survives. */
export const phaseKey = (base: string) => (PHASE === 1 ? base : `${base}-p${PHASE}`);

export function switchPhase(n: number) {
  if (n === PHASE || !DATASETS.has(n)) return;
  try {
    localStorage.setItem(PHASE_KEY, String(n));
  } catch {
    /* the URL below still selects it */
  }
  const url = new URL(location.href);
  url.searchParams.set('phase', String(n));
  location.assign(url.toString());
}
