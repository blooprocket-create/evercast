import { OfflineProgressor, type OfflineSummary } from '../engine/offline/OfflineProgressor';
import type { EvercastScene } from '../game/EvercastScene';
import { sceneMoodFor } from '../game/audio/AudioEngine';
import { audio, saveGame, simulation, snapshotStore } from './runtime';

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
    onAwayProgress(backgroundProgressor.apply(simulation, elapsedSeconds));

    // Whatever happened while away is already in the summary; replaying it as
    // sound would be a wall of hits for a fight nobody watched.
    simulation.drainPresentationEvents();
    const next = simulation.getSnapshot();
    audio.setScene(sceneMoodFor(next));
    scene.sync(next, 0, []);
    snapshotStore.publish(next);
    publishAccumulator = 0;
    saveGame();
  };

  const loop = (now: number) => {
    if (document.hidden) {
      previous = now;
      frame = requestAnimationFrame(loop);
      return;
    }

    const delta = Math.min((now - previous) / 1000, MAX_FRAME_SECONDS);
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
