import { navPlan, type From, type NavKind, type NavPlan, type NavStep } from './labels';
import { X_MIDDLE, Y_PROMENADE, inArea, type Pt } from './venue';

/** Icon for a manoeuvre. */
export const NAV_ICON: Record<NavKind, string> = {
  approach: '📍',
  complex: '🚶',
  exit: '🚪',
  zone: '➜',
  platform: '➜',
  toPavilion: '➜',
  enter: '🚪',
  floorUp: '⬆',
  floorDown: '⬇',
  floorStay: '≡',
  sector: '🔎',
  stand: '🎯',
  extra: '➕',
};

const d = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Where on the current walking path (venue units, from the user / current hall / entrance) a step's
 * manoeuvre happens, and how far along the path that is. Only for steps that map onto the path:
 * zone changes, Middle Platform, the target pavilion door. Indoor steps have no position.
 */
export function stepOnPath(step: NavStep, path: Pt[]): { units: number; at: Pt } | null {
  if (path.length < 2) return null;
  let hit = -1;
  if (step.kind === 'zone' && step.zone) {
    // The zone's footprint plus the walkways along it (Pearl Promenade, D ↔ A link, forecourts).
    if (inArea(step.zone, path[0], 0.5)) return null;
    hit = path.findIndex((p) => inArea(step.zone!, p, 0.5));
    if (hit === path.length - 1) hit = -1; // that is the pavilion door itself — shown on the pavilion step
  } else if (step.kind === 'platform') {
    const m = { x: X_MIDDLE, y: Y_PROMENADE };
    hit = path.findIndex((p) => d(p, m) < 0.35);
  } else if (step.kind === 'toPavilion' || step.kind === 'enter') {
    hit = path.length - 1;
  }
  if (hit <= 0) return null;
  let units = 0;
  for (let i = 1; i <= hit; i++) units += d(path[i - 1], path[i]);
  return { units, at: path[hit] };
}

export interface NavState {
  on: boolean;
  /** Current step index, valid for the step list identified by `key`. */
  idx: number;
  key: string;
}

export const navKey = (steps: NavStep[]) => steps.map((s) => s.text).join('|');

export interface NavGuide {
  plan: NavPlan;
  key: string;
  idx: number;
  now: NavStep;
  next?: NavStep;
  /** Metres along the path to the current / next manoeuvre (only where it lies on the path). */
  nowM?: number;
  nextM?: number;
  /** The next point on the map to walk to. */
  waypoint?: Pt;
}

/** Current instruction for navigation mode. */
export function navGuide(from: From, hall: string, booths: string[], nav: NavState, path: Pt[], mPerUnit: number): NavGuide | null {
  const plan = navPlan(from, hall, booths);
  if (!plan.steps.length) return null;
  const key = navKey(plan.steps);
  const idx = nav.key === key ? Math.max(0, Math.min(nav.idx, plan.steps.length - 1)) : 0;
  const now = plan.steps[idx];
  const next = plan.steps[idx + 1];
  const a = stepOnPath(now, path);
  const b = next ? stepOnPath(next, path) : null;
  let waypoint = a?.at ?? b?.at;
  if (!waypoint) for (const st of plan.steps.slice(idx)) waypoint ??= stepOnPath(st, path)?.at;
  return { plan, key, idx, now, next, nowM: a ? a.units * mPerUnit : undefined, nextM: b ? b.units * mPerUnit : undefined, waypoint };
}
