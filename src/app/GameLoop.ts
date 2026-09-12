import {
  OfflineProgressor,
  type OfflineCatchUp,
  type OfflineSummary,
} from '../engine/offline/OfflineProgressor';
import type { EvercastScene } from '../game/EvercastScene';
import { sceneMoodFor } from '../game/audio/AudioEngine';
// prettier-ignore
import { audio, awayDebt, saveGame, setAwayDebt, simulation, snapshotStore } from './runtime';

/**
 * Owns the browser-side cadences so they are named and separable rather than
 * tangled inside a component effect:
 *
 *   every frame   simulation tick, away-time catch-up and scene sync
 *   10 Hz         publish a snapshot to the interface
 *   10 s          autosave
 *
 * The scene needs fresh enemy positions every frame; the interface does not,
 * which is why the two run at different rates.
 */
const UI_PUBLISH_SECONDS = 0.1;
const AUTOSAVE_MS = 10_000;
/** A long frame (tab throttling, a stall) must not advance the world in one jump. */
const MAX_FRAME_SECONDS = 0.25;
/**
 * How much of a frame away-time catch-up may take. A day of it is seconds of
 * solid simulation, so it is metered rather than run to completion: the world
 * stays on screen and playable while it works, which is the whole point of
 * paying the debt here instead of before the first paint.
 *
 * It is a share of the frame rather than a fixed slice, because a fixed few
 * milliseconds of a long frame is a tiny duty cycle - the weaker the device, the
 * longer a day would take to settle. The cap is what keeps the frame answerable
 * once the share itself grows large.
 */
const CATCH_UP_FRAME_SHARE = 0.5;
const CATCH_UP_MIN_BUDGET_MS = 8;
/** A backstop against a pathological frame (the first one, or one after a stall). */
const CATCH_UP_MAX_BUDGET_MS = 100;
/**
 * The slice has to be small enough that the budget above is what binds, not the
 * slice: the clock is only read between slices, so one slice costing more than a
 * whole budget collapses catch-up to a single slice per frame however much room
 * the frame had. A second of world time is a handful of events.
 */
const CATCH_UP_SLICE_SECONDS = 1;

export interface GameLoopOptions {
  scene: EvercastScene;
  onAwayProgress: (summary: OfflineSummary) => void;
}

export function startGameLoop({ scene, onAwayProgress }: GameLoopOptions): () => void {
  const backgroundProgressor = new OfflineProgressor(simulation.config.maxOfflineSeconds);
  let previous = performance.now();
  let publishAccumulator = 0;
  let frame = 0;
  let hiddenAt = document.hidden ? Date.now() : null;

  /**
   * The debt itself lives in the runtime, so a loop rebuilt mid catch-up picks up
   * where the last one left off and every save carries what is still owed. This
   * is only the worker that pays it down.
   */
  let catchUp: OfflineCatchUp | null = null;
  const owe = (seconds: number) => {
    if (seconds <= 0) return;
    if (catchUp) catchUp.extend(seconds);
    else catchUp = backgroundProgressor.begin(simulation, seconds);
    // Report it back already capped, so the stamp on the next save is honest.
    setAwayDebt(catchUp.remainingSeconds);
  };
  owe(awayDebt());

  const saveTimer = window.setInterval(saveGame, AUTOSAVE_MS);
  const onBeforeUnload = () => saveGame();

  /** Works the away-time debt down within this frame's share, if any is owed. */
  const drainCatchUp = (frameMs: number) => {
    if (!catchUp || catchUp.done) return;

    const budgetMs = Math.min(
      CATCH_UP_MAX_BUDGET_MS,
      Math.max(CATCH_UP_MIN_BUDGET_MS, frameMs * CATCH_UP_FRAME_SHARE),
    );
    const deadline = performance.now() + budgetMs;
    catchUp.advanceWhile(CATCH_UP_SLICE_SECONDS, () => performance.now() < deadline);
    setAwayDebt(catchUp.remainingSeconds);

    if (!catchUp.done) return;

    const summary = catchUp.summary();
    catchUp = null;
    // Whatever happened while away is already in the summary; replaying it as
    // sound would be a wall of hits for a fight nobody watched.
    simulation.drainPresentationEvents();
    saveGame();
    if (summary.secondsApplied > 0) onAwayProgress(summary);
  };

  const onVisibilityChange = () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      audio.setSuspended(true);
      saveGame();
      return;
    }

    audio.setSuspended(false);

    previous = performance.now();
    if (hiddenAt === null) return;

    const elapsedSeconds = Math.max(0, (Date.now() - hiddenAt) / 1000);
    hiddenAt = null;
    // Hidden time joins the same debt the boot catch-up uses, so a long spell in
    // a background tab cannot lock the frame it comes back on either.
    owe(elapsedSeconds);
    saveGame();
  };

  const loop = (now: number) => {
    if (document.hidden) {
      previous = now;
      frame = requestAnimationFrame(loop);
      return;
    }

    const frameMs = now - previous;
    const delta = Math.min(frameMs / 1000, MAX_FRAME_SECONDS);
    previous = now;
    // Catch up first, so live time is always the most recent thing simulated.
    drainCatchUp(frameMs);
    simulation.update(delta);

    const next = simulation.getSnapshot();
    const events = simulation.drainPresentationEvents();
    scene.sync(next, delta, events);
    audio.handleEvents(events);

    publishAccumulator += delta;
    if (publishAccumulator >= UI_PUBLISH_SECONDS) {
      snapshotStore.publish(next);
      audio.setScene(sceneMoodFor(next));
      publishAccumulator = 0;
    }

    frame = requestAnimationFrame(loop);
  };

  window.addEventListener('beforeunload', onBeforeUnload);
  document.addEventListener('visibilitychange', onVisibilityChange);
  frame = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(frame);
    window.clearInterval(saveTimer);
    window.removeEventListener('beforeunload', onBeforeUnload);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    saveGame();
  };
}
