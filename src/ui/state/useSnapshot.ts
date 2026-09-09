import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { SnapshotStore } from '../../app/SnapshotStore';
import type { SimulationSnapshot } from '../../engine/types';

/**
 * The snapshot is a brand-new object graph on every build, so memoizing on it
 * by identity can never hit. Selecting *scalars* sidesteps that entirely: a
 * component that reads `s.gold.display` gets a string, which compares by value,
 * so it re-renders only when the displayed value actually changes.
 *
 * For the few array or object reads (`gear`, `enemies`, `activeSpellNodeIds`)
 * pass an equality function, or select a derived scalar signature instead.
 */
export function createSnapshotHooks(store: SnapshotStore) {
  function useSnapshotSelector<T>(
    select: (snapshot: SimulationSnapshot) => T,
    isEqual: (a: T, b: T) => boolean = Object.is,
  ): T {
    // Held in refs so `getSelection` stays referentially stable even when the
    // caller passes an inline arrow, which is the common case.
    const selectRef = useRef(select);
    selectRef.current = select;
    const isEqualRef = useRef(isEqual);
    isEqualRef.current = isEqual;
    const cache = useRef<{ source: SimulationSnapshot; value: T } | null>(null);

    const getSelection = useCallback((): T => {
      const source = store.getSnapshot();
      const cached = cache.current;
      if (cached && cached.source === source) return cached.value;

      const value = selectRef.current(source);
      if (cached && isEqualRef.current(cached.value, value)) {
        // Equal by value: keep the previous reference so React sees no change.
        cache.current = { source, value: cached.value };
        return cached.value;
      }
      cache.current = { source, value };
      return value;
    }, []);

    return useSyncExternalStore(store.subscribe, getSelection, getSelection);
  }

  /** Escape hatch for a component that genuinely needs the whole snapshot. */
  function useSnapshot(): SimulationSnapshot {
    return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  }

  return { useSnapshot, useSnapshotSelector };
}

/** Shallow array equality, for the handful of list selections. */
export function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}
