import { DEFAULT_ENGINE_CONFIG } from '../engine/config';
import { EvercastSimulation } from '../engine/EvercastSimulation';
import type { EngineCommand } from '../engine/types';
import { AudioEngine } from '../game/audio/AudioEngine';
import { BrowserSaveStore } from './BrowserSaveStore';
import { SnapshotStore } from './SnapshotStore';
import { UiSettingsStore } from './UiSettingsStore';

const SAVE_KEY = 'evercast.save.v1';

/**
 * Reaching for `localStorage` is itself a throwing operation in a sandboxed
 * iframe or on an opaque origin - not just reading from it. This module runs
 * while the graph is still evaluating, so that throw would be a blank page
 * rather than a handled error. No storage means the game still runs; it just
 * does not persist.
 */
function resolveStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch (error) {
    console.warn('Evercast storage is unavailable; progress will not be saved.', error);
    return null;
  }
}

const storage = resolveStorage();
const saveStore = new BrowserSaveStore(DEFAULT_ENGINE_CONFIG, SAVE_KEY, storage);
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
 * Away time accepted but not yet simulated.
 *
 * It is deliberately not applied at boot. A day of catch-up is seconds of solid
 * simulation, and spending it before the first paint is what a player sees as
 * the game failing to start; the loop pays it down across frames instead, so
 * the world is on screen and playable while it catches up.
 *
 * It is owned here rather than inside the loop because every way out of the
 * session has to carry it - an autosave, a player command, an export, a torn
 * down loop. A save stamped `now` while time is still owed banks a partial day
 * as though it were the whole one.
 */
let awayDebtSeconds =
  loaded && boot.resumed ? Math.max(0, (Date.now() - loaded.savedAt.getTime()) / 1000) : 0;

export function awayDebt(): number {
  return awayDebtSeconds;
}

/** The loop reports what its catch-up still owes, already capped. */
export function setAwayDebt(seconds: number): void {
  awayDebtSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
}

export const snapshotStore = new SnapshotStore(simulation.getSnapshot());

/** Preferences live apart from the save, under their own key. */
export const uiSettings = new UiSettingsStore(storage);

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
 * The stamp is what boot measures away time against, so it is pulled back by
 * whatever is still owed: leaving mid catch-up then resumes owing the remainder
 * instead of banking a partial day as the whole one.
 */
function stampFor(): Date {
  return new Date(Date.now() - awayDebtSeconds * 1000);
}

export function saveGame(): void {
  saveStore.save(simulation.getState(), stampFor());
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
  return saveStore.exportSave(simulation.getState(), stampFor());
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
