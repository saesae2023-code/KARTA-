import { POINTS } from './data';
import type { PointState } from './types';

export function computeStats(states: Record<number, PointState>) {
  const all = POINTS.map((p) => ({ p, s: states[p.id] }));
  return {
    total: POINTS.length,
    visited: all.filter((x) => x.s.visit === 'visited').length,
    remaining: all.filter((x) => x.s.visit === 'pending').length,
    remainingA: all.filter((x) => x.s.visit === 'pending' && x.p.priority === 'A').length,
    contacts: all.filter((x) => x.s.contact).length,
    followUp: all.filter((x) => x.s.followUp).length,
    price: all.filter((x) => x.s.price).length,
    skipped: all.filter((x) => x.s.visit === 'skipped').length,
  };
}
