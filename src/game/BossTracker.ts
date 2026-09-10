import type { GameEvent } from '../engine/events/GameEvent';

/**
 * Remembers which live enemies are bosses.
 *
 * Boss identity appears exactly once, on `enemy_spawned`; `enemy_killed` does
 * not carry it, and a boss stage spawns ordinary adds alongside the boss, so an
 * encounter-level flag would treat every minion's death as the boss falling.
 * Both the audio engine and the combat-feel layer need the answer, so the
 * bookkeeping lives here rather than twice.
 */
export class BossTracker {
  private readonly ids = new Set<number>();

  /** Call before planning a batch: a boss can spawn and die in the same one. */
  note(events: readonly GameEvent[]): void {
    for (const event of events) {
      if (event.type === 'enemy_spawned' && event.boss) this.ids.add(event.instanceId);
    }
  }

  readonly has = (instanceId: number): boolean => this.ids.has(instanceId);

  /** Call after planning, so the batch that kills a boss still knows it was one. */
  forget(events: readonly GameEvent[]): void {
    for (const event of events) {
      if (event.type === 'enemy_killed') this.ids.delete(event.instanceId);
    }
  }

  clear(): void {
    this.ids.clear();
  }

  get size(): number {
    return this.ids.size;
  }
}
