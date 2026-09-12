import { OfflineProgressor, type OfflineSummary } from '../engine/offline/OfflineProgressor';
import type { EvercastScene } from '../game/EvercastScene';
import { sceneMoodFor } from '../game/audio/AudioEngine';
// prettier-ignore
import { addAwayDebt, audio, awayDebt, saveGame, setAwayDebt, simulation, snapshotStore } from './runtime';

/**
 * Owns the browser-side cadences so they are named and separable rather than
 * tangled inside a component effect:
 *
 *   every frame   simulation tick and scene sync
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

  const saveTimer = window.setInterval(saveGame, AUTOSAVE_MS);
  const onBeforeUnload = () => saveGame();

  /**
   * Settles an absence in one call. Offline progress costs what its sample costs
   * rather than what the absence was worth, so this is a fixed price however long
   * the player was gone - which is what lets it happen in one go, with no window
   * in between for live time or a player command to get into the result.
   */
  const settleAway = (seconds: number) => {
    if (seconds <= 0) return;
    const summary = backgroundProgressor.apply(simulation, seconds);
    setAwayDebt(0);

    // Whatever happened while away is already in the summary; replaying it as
    // sound would be a wall of hits for a fight nobody watched.
    simulation.drainPresentationEvents();
    const next = simulation.getSnapshot();
    audio.setScene(sceneMoodFor(next));
    scene.sync(next, 0, []);
    snapshotStore.publish(next);
    publishAccumulator = 0;
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
    // Handed to the loop rather than settled here, so a tab that was hidden at
    // boot settles one absence and shows one summary instead of two.
    addAwayDebt(elapsedSeconds);
    saveGame();
  };

  /**
   * A frame that threw used to end the game.
   *
   * The loop re-arms itself at the end of its own callback, so an exception
   * anywhere in a frame meant it was never re-armed: the world stopped advancing
   * and stopped being drawn, permanently, with no way back but a reload. It did
   * not present as an error either. Babylon drives its own render loop, so the
   * canvas went on painting the last state it was given, and React went on
   * handling clicks - a frozen game with working menus.
   *
   * So the frame is wrapped and the loop is re-armed regardless. A transient
   * failure now costs one frame instead of the session, and a persistent one
   * says so instead of looking like a hang.
   */
  let frameFailures = 0;
  const reportFrameFailure = (error: unknown) => {
    frameFailures += 1;
    // The first one carries the trace worth having. After that, back off: a
    // wedged simulation would otherwise write sixty lines a second and bury it.
    if (frameFailures === 1 || frameFailures % 600 === 0) {
      console.error(
        `Evercast frame failed (${frameFailures}x) - the loop is still running.`,
        error,
      );
    }
  };

  const step = (now: number) => {
    if (document.hidden) {
      previous = now;
      return;
    }

    // Time owed from before this session is settled on the first frame rather
    // than on the way to it. `runtime` is imported before the first render, so
    // anything that throws there is a blank page rather than a handled error -
    // and here a failure costs the away progress, not the game.
    const owed = awayDebt();
    if (owed > 0) {
      try {
        settleAway(owed);
      } catch (error) {
        console.error('Evercast away progress could not be applied.', error);
        setAwayDebt(0);
      }
    }

    const frameMs = now - previous;
    const delta = Math.min(frameMs / 1000, MAX_FRAME_SECONDS);
    previous = now;
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
  };

  const loop = (now: number) => {
    try {
      step(now);
    } catch (error) {
      reportFrameFailure(error);
    }
    // Outside the catch on purpose: this is what makes a bad frame survivable.
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
