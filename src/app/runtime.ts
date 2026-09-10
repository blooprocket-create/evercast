import { DEFAULT_ENGINE_CONFIG } from '../engine/config';
import { EvercastSimulation } from '../engine/EvercastSimulation';
import { OfflineProgressor, type OfflineSummary } from '../engine/offline/OfflineProgressor';
import type { EngineCommand } from '../engine/types';
import { AudioEngine } from '../game/audio/AudioEngine';
import { BrowserSaveStore } from './BrowserSaveStore';
import { SnapshotStore } from './SnapshotStore';
import { UiSettingsStore } from './UiSettingsStore';

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

/** Preferences live apart from the save, under their own key. */
export const uiSettings = new UiSettingsStore(
  typeof localStorage === 'undefined' ? null : localStorage,
);

/**
 * Sound outlives the scene. Effect quality rebuilds `EvercastScene` and with it
 * the game loop, and an AudioContext torn down alongside it would cut the music
 * mid-bar and then need another click to come back - so the engine is owned
 * here, started once, and bound straight to the settings it belongs to.
 */
export const audio = new AudioEngine();
audio.setMix(uiSettings.getSettings().audio);
uiSettings.subscribe(() => audio.setMix(uiSettings.getSettings().audio));
audio.start();

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

export function exportSaveFile(): string {
  return saveStore.exportSave(simulation.getState());
}

/**
 * Import and erase both write storage and then reload, rather than trying to
 * swap the state under a running simulation and a live Babylon scene. A boot is
 * the one code path already guaranteed to build everything consistently.
 */
export function importSaveFile(json: string): void {
  saveStore.importSave(json);
  window.location.reload();
}

export function eraseSave(): void {
  saveStore.clear();
  window.location.reload();
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
