import { useCallback, useEffect, useState } from 'react';
import { POINTS } from './data';
import { initialStateFor } from './logic';
import type { PointState } from './types';

const KEY = 'altiora-canton-fair-v1';

interface Persisted {
  states: Record<number, PointState>;
  currentHall: string | null;
}

function defaults(): Persisted {
  return { states: Object.fromEntries(POINTS.map((p) => [p.id, initialStateFor(p)])), currentHall: null };
}

function load(): Persisted {
  const base = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Persisted> | null;
    if (!saved) return base;
    for (const p of POINTS) {
      const s = saved.states?.[p.id];
      if (s) base.states[p.id] = { ...base.states[p.id], ...s };
    }
    base.currentHall = saved.currentHall ?? null;
  } catch {
    /* storage unavailable or corrupted: start from Excel defaults */
  }
  return base;
}

export function useAppStore() {
  const [data, setData] = useState<Persisted>(load);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      /* ignore quota / private mode */
    }
  }, [data]);

  const update = useCallback((id: number, patch: Partial<PointState>) => {
    setData((d) => ({
      ...d,
      states: { ...d.states, [id]: { ...d.states[id], ...patch, updatedAt: new Date().toISOString() } },
    }));
  }, []);

  const setCurrentHall = useCallback((currentHall: string | null) => setData((d) => ({ ...d, currentHall })), []);

  const replaceAll = useCallback((next: Persisted) => setData(next), []);
  const reset = useCallback(() => setData({ ...defaults(), currentHall: null }), []);

  return { ...data, update, setCurrentHall, replaceAll, reset, snapshot: data };
}

export type AppStore = ReturnType<typeof useAppStore>;
export type { Persisted };
