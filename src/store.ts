import { phaseKey } from './phase';
import { useCallback, useEffect, useState } from 'react';
import { POINTS } from './data';
import { initialStateFor } from './logic';
import type { Anchor } from './geo';
import type { RouteLock, RouteMode } from './route';
import type { PointState } from './types';

const KEY = phaseKey('altiora-canton-fair-v1');

interface Persisted {
  states: Record<number, PointState>;
  currentHall: string | null;
  routeMode: RouteMode;
  /** Order of the active route; recomputed only on explicit events, not on GPS jitter. */
  lock: RouteLock | null;
  /** On-site GPS calibration anchors ("Я в Hall X"). */
  anchors: Anchor[];
  /** GPS was enabled by the user (map tab). */
  gpsOn: boolean;
}

function defaults(): Persisted {
  return { states: Object.fromEntries(POINTS.map((p) => [p.id, initialStateFor(p)])), currentHall: null, routeMode: 'nearest', lock: null, anchors: [], gpsOn: false };
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
    if (saved.lock && Array.isArray(saved.lock.items)) base.lock = saved.lock;
    if (Array.isArray(saved.anchors)) base.anchors = saved.anchors.filter((a) => a && a.kind === 'calib');
    base.gpsOn = saved.gpsOn === true;
    if (saved.routeMode === 'nearest' || saved.routeMode === 'aFirst' || saved.routeMode === 'onlyA') base.routeMode = saved.routeMode;
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

  const setRouteMode = useCallback((routeMode: RouteMode) => setData((d) => ({ ...d, routeMode })), []);

  const setLock = useCallback((lock: RouteLock | null) => setData((d) => ({ ...d, lock })), []);
  const addAnchor = useCallback((a: Anchor) => setData((d) => ({ ...d, anchors: [...d.anchors.filter((x) => x.label !== a.label), a].slice(-8) })), []);
  const clearAnchors = useCallback(() => setData((d) => ({ ...d, anchors: [] })), []);
  const setGpsOn = useCallback((gpsOn: boolean) => setData((d) => ({ ...d, gpsOn })), []);

  const replaceAll = useCallback((next: Persisted) => setData(next), []);
  const reset = useCallback(() => setData((d) => ({ ...defaults(), routeMode: d.routeMode, anchors: d.anchors, gpsOn: d.gpsOn })), []);

  return { ...data, update, setCurrentHall, setRouteMode, setLock, addAnchor, clearAnchors, setGpsOn, replaceAll, reset, snapshot: data };
}

export type AppStore = ReturnType<typeof useAppStore>;
export type { Persisted };
