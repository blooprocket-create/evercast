import { createInstallStore, registerServiceWorker } from './Installable';
import { AwayClock } from './AwayClock';
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
 * Every measurement of absence goes through here rather than through a bare
 * `Date.now()` subtraction. `AwayClock` explains why at length; the short of it
 * is that the only clock this game has belongs to the player, and a high-water
 * mark is what stops moving it forward paying out twice.
 */
const awayClock = new AwayClock(storage, DEFAULT_ENGINE_CONFIG.maxOfflineSeconds);

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
 * Whether this session picked up a save or started one. The boot gate reads it
 * to decide whether it is greeting someone or welcoming them back, which is the
 * whole difference between a title screen and a Continue button. A save that
 * failed to resume counts as fresh, because that is what the player is about to
 * be playing.
 */
export const resumedFromSave = boot.resumed;

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
let awayDebtSeconds = loaded && boot.resumed ? awayClock.claim(loaded.savedAt.getTime()) : 0;

export function awayDebt(): number {
  return awayDebtSeconds;
}

/**
 * When this module was evaluated, which is as near as anything gets to when the
 * player opened the game.
 *
 * `awayDebtSeconds` above covers the gap from the save's stamp to this moment.
 * Everything after it - the boot gate, waiting on assets, a title screen left
 * open while someone made coffee - was covered by nothing at all, and the first
 * save after pressing Continue stamps `now` and erases it permanently.
 */
const bootedAt = Date.now();
let gateCredited = false;

/**
 * Hands the loop the time the player spent in front of the boot gate.
 *
 * The two intervals are adjacent rather than overlapping - save to boot, then
 * boot to Begin - so this adds to the debt rather than replacing it, and the
 * one settlement on the first frame pays off both. Credited at most once: a
 * second call would bill the same minutes twice.
 */
export function creditTimeAtTheGate(): void {
  if (gateCredited) return;
  gateCredited = true;
  addAwayDebt(awayClock.claim(bootedAt));
}

/** The loop reports back once it has settled what was owed. */
export function setAwayDebt(seconds: number): void {
  awayDebtSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
}

/**
 * The debt was simulated, so the time it covered is now spent.
 *
 * Separate from `setAwayDebt(0)` because the two mean different things and the
 * loop needs both: this one commits the clock's high-water mark, and it must
 * never run on the path where applying the away progress threw. Dropping a debt
 * that could not be applied is a bad frame; dropping it *and* marking the hours
 * as paid would be those hours gone for good.
 */
export function settleAwayDebt(): void {
  awayDebtSeconds = 0;
  awayClock.settle();
}

/** Hidden time joins whatever boot already owed, so one path settles both. */
export function addAwayDebt(seconds: number): void {
  if (Number.isFinite(seconds) && seconds > 0) awayDebtSeconds += seconds;
}

/**
 * What a stretch of hidden time is worth, measured against the same high-water
 * mark the boot path uses. The loop asks rather than subtracting two
 * `Date.now()` readings of its own, so a clock moved forward while the tab was
 * in the background is worth no more than one moved forward before it opened.
 */
export function claimAwaySince(stamp: number): number {
  return awayClock.claim(stamp);
}

export const snapshotStore = new SnapshotStore(simulation.getSnapshot());

/** Preferences live apart from the save, under their own key. */
export const uiSettings = new UiSettingsStore(storage);

/**
 * Offline launch and the home-screen icon. Both are strictly additive: the
 * game ran without either for its whole life and still does if a browser
 * offers neither.
 */
export const installStore = createInstallStore();
registerServiceWorker();

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

/**
 * Set once the stored save has been deliberately replaced or removed. It is
 * never cleared, because the only thing that follows it is a reload.
 *
 * `window.location.reload()` schedules a navigation; it does not perform one.
 * Everything holding this session goes on running until it lands - the autosave
 * interval, a visibility change, and above all the loop's `beforeunload`
 * handler, which exists precisely to write one last save on the way out. So
 * erasing used to be: remove the key, ask for a reload, and then have the
 * outgoing save put the whole run back under it. The player pressed Erase,
 * watched the page reload, and arrived back in the run they had just deleted -
 * and import lost the file it had just accepted the same way.
 *
 * Every write to the save goes through `saveGame`, so one latch in front of it
 * closes all of them at once. That is why it lives here rather than as a
 * `removeEventListener` in the loop: a handler taken off can only cover the
 * writers that exist today, and the autosave interval would still have fired.
 */
let persistenceHalted = false;

export function saveGame(): void {
  if (persistenceHalted) return;
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
  // Decoded first, and the latch dropped only after it returns: a file the
  // codec refuses throws out of here with storage untouched, and that session
  // has to go on saving exactly as though nothing had been attempted.
  saveStore.importSave(json);
  persistenceHalted = true;
  window.location.reload();
}

export function eraseSave(): void {
  // Latched before the key is removed, not after: an autosave landing between
  // the two would write the run straight back.
  persistenceHalted = true;
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
