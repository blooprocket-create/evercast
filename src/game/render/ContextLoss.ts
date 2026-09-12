import type { Observer } from '@babylonjs/core';

/**
 * Says out loud when the GPU context goes, and when it comes back.
 *
 * A browser reclaims GPU resources from a tab it has left in the background, so
 * a long absence can end with the context already gone. Babylon restores what it
 * can on its own, but nothing here said either thing had happened - which left a
 * canvas that had stopped updating indistinguishable from a game that had
 * stopped, with nothing in the console to tell them apart.
 *
 * This only reports. Recovery is Babylon's, and whether a frame then throws is
 * the game loop's problem - it survives one either way.
 */

/** The slice of the engine this needs, so a `NullEngine` can stand in for it. */
export interface ContextLossSource {
  onContextLostObservable: {
    add(callback: () => void): Observer<never> | null;
    remove(observer: Observer<never> | null): unknown;
  };
  onContextRestoredObservable: {
    add(callback: () => void): Observer<never> | null;
    remove(observer: Observer<never> | null): unknown;
  };
}

export const CONTEXT_LOST_MESSAGE =
  'Evercast lost the GPU context - the world will stop drawing until it is restored.';
export const CONTEXT_RESTORED_MESSAGE = 'Evercast recovered the GPU context.';

export interface ContextLossReporters {
  onLost?: (message: string) => void;
  onRestored?: (message: string) => void;
}

/** Registers the reporting and returns the function that takes it back off. */
export function watchContextLoss(
  engine: ContextLossSource,
  { onLost, onRestored }: ContextLossReporters = {},
): () => void {
  const lost = engine.onContextLostObservable.add(() =>
    (onLost ?? ((message: string) => console.error(message)))(CONTEXT_LOST_MESSAGE),
  );
  const restored = engine.onContextRestoredObservable.add(() =>
    (onRestored ?? ((message: string) => console.info(message)))(CONTEXT_RESTORED_MESSAGE),
  );

  return () => {
    engine.onContextLostObservable.remove(lost);
    engine.onContextRestoredObservable.remove(restored);
  };
}
