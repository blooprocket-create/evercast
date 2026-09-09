import type { SimulationSnapshot } from '../engine/types';

type Listener = () => void;

/**
 * Holds the latest snapshot and tells React when it changes.
 *
 * `getSnapshot` returns the same object between publishes, which is what
 * `useSyncExternalStore` requires — returning a freshly built snapshot on
 * every read would loop forever.
 */
export class SnapshotStore {
  private current: SimulationSnapshot;
  private readonly listeners = new Set<Listener>();

  constructor(initial: SimulationSnapshot) {
    this.current = initial;
  }

  readonly getSnapshot = (): SimulationSnapshot => this.current;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  publish(next: SimulationSnapshot): void {
    if (next === this.current) return;
    this.current = next;
    for (const listener of this.listeners) listener();
  }
}
