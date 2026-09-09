import { DEFAULT_ENGINE_CONFIG } from '../engine/config';
import { EvercastSimulation } from '../engine/EvercastSimulation';
import { OfflineProgressor, type OfflineSummary } from '../engine/offline/OfflineProgressor';
import type { EngineCommand } from '../engine/types';
import { BrowserSaveStore } from './BrowserSaveStore';
import { SnapshotStore } from './SnapshotStore';

const saveStore = new BrowserSaveStore(DEFAULT_ENGINE_CONFIG);
const loaded = saveStore.load();

export const simulation = new EvercastSimulation({ initialState: loaded?.state });

/** The away progress applied at boot. Later summaries come from the game loop. */
export const initialOfflineSummary: OfflineSummary | null = loaded
  ? new OfflineProgressor(simulation.config.maxOfflineSeconds).apply(
      simulation,
      Math.max(0, (Date.now() - loaded.savedAt.getTime()) / 1000),
    )
  : null;

export const snapshotStore = new SnapshotStore(simulation.getSnapshot());

export function saveGame(): void {
  saveStore.save(simulation.getState());
}

/**
 * Every player action goes through here: apply it, republish so the interface
 * sees the result immediately rather than waiting for the next tick, and save.
 * Returns whether the engine accepted it.
 */
export function runCommand(command: EngineCommand): boolean {
  if (!simulation.execute(command)) return false;
  snapshotStore.publish(simulation.getSnapshot());
  saveGame();
  return true;
}

/**
 * Applies the same command until the engine refuses or `limit` is reached,
 * publishing and saving once at the end rather than on every step. The engine
 * stays the authority on affordability, so the interface never has to
 * reimplement the cost curve to know how many levels a player can buy.
 */
export function runCommandRepeated(command: EngineCommand, limit: number): number {
  let applied = 0;
  while (applied < limit && simulation.execute(command)) applied += 1;
  if (applied > 0) {
    snapshotStore.publish(simulation.getSnapshot());
    saveGame();
  }
  return applied;
}
