import { DEFAULT_ENGINE_CONFIG } from '../engine/config';
import { EvercastSimulation } from '../engine/EvercastSimulation';
import type { EngineCommand } from '../engine/types';
import { AudioEngine } from '../game/audio/AudioEngine';
import { BrowserSaveStore } from './BrowserSaveStore';
import { SnapshotStore } from './SnapshotStore';
import { UiSettingsStore } from './UiSettingsStore';

const saveStore = new BrowserSaveStore(DEFAULT_ENGINE_CONFIG);
const loaded = saveStore.load();

/**
 * Nothing here may throw. This module is imported on the way to the first
 * render, so an exception is not a handled error - it is a blank page, on every
 * reload, for as long as the save that caused it is in storage. A save that
 * cannot be brought up is worth strictly less than a game that boots, so the
 * state is dropped and the reason is reported rather than taking the app down.
 */
function startSimulation(): { simulation: EvercastSimulation; resumed: boolean } {
  if (!loaded) return { simulation: new EvercastSimulation(), resumed: false };
  try {
    return { simulation: new EvercastSimulation({ initialState: loaded.state }), resumed: true };
  } catch (error) {
    console.error('Evercast save could not be resumed; starting fresh.', error);
    return { simulation: new EvercastSimulation(), resumed: false };
  }
}

const boot = startSimulation();

export const simulation = boot.simulation;

/**
 * Away time owed at boot, for the game loop to work off.
 *
 * It is deliberately not applied here. A day of catch-up is seconds of solid
 * simulation, and spending it before the first paint is what a player sees as
 * the game failing to start; the loop pays it down across frames instead, so
 * the world is on screen and playable while it catches up.
 */
let pendingAwaySeconds =
  loaded && boot.resumed ? Math.max(0, (Date.now() - loaded.savedAt.getTime()) / 1000) : 0;

/**
 * Hands the outstanding away time to the caller exactly once. The game loop is
 * rebuilt whenever effect quality changes, and away time must not be paid twice.
 */
export function takePendingAwaySeconds(): number {
  const owed = pendingAwaySeconds;
  pendingAwaySeconds = 0;
  return owed;
}

/**
 * Hands unspent away time back, so tearing the loop down part-way through a
 * catch-up (changing effect quality rebuilds it) defers the rest instead of
 * quietly dropping the progress it stood for.
 */
export function returnPendingAwaySeconds(seconds: number): void {
  if (seconds > 0) pendingAwaySeconds += seconds;
}

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

/**
 * `outstandingAwaySeconds` is away time accepted but not yet simulated. Saving
 * with the stamp pulled back by that much is what makes a tab closed mid
 * catch-up resume owing the remainder, rather than banking a partial day.
 */
export function saveGame(outstandingAwaySeconds = 0): void {
  const savedAt = new Date(Date.now() - Math.max(0, outstandingAwaySeconds) * 1000);
  saveStore.save(simulation.getState(), savedAt);
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
