/**
 * What the boot gate is waiting on, as a pure function of two facts.
 *
 * Start, loading and "press to play" are one state machine rather than three
 * screens. The expensive part of boot - four megabytes of environment, one and
 * a half of characters, and Babylon itself - streams *behind* the gate while
 * the player is reading the title, so the wait costs nothing it was not already
 * costing. There is no separate loading screen because there is nothing for one
 * to do that the gate is not already doing.
 */
export type BootPhase = 'preparing' | 'ready' | 'settling' | 'playing';

export interface BootConditions {
  /** The scene reported its assets in, or the wait below was abandoned. */
  assetsSettled: boolean;
  /** The player pressed the button. */
  begun: boolean;
  /**
   * The away debt has been paid down, so the world on the other side of the
   * gate is the world the player left.
   *
   * `GameLoop` settles an absence in one synchronous call on its first frame -
   * up to ten minutes of simulation, which measured 1.3-2.0s of blocked main
   * thread on a built-up save. The gate used to be gone by then, so the first
   * seconds of every session were a frozen interface with nothing saying why,
   * and anything that measured itself in that window came out wrong: opening
   * the spell tree mid-stall gave a ResizeObserver viewport of {0,0}.
   *
   * Defaults to true so that a caller with nothing owed - and every existing
   * test - keeps the two-state behaviour it had.
   */
  awaySettled?: boolean;
}

/**
 * How long the gate waits on assets before opening anyway.
 *
 * The gate must never be a trap. A 404 on a GLB, a wedged connection, a browser
 * that throttles a background tab through the whole download - none of those
 * stop the game being playable, because `ActorAssets` already falls back to
 * primitives and the simulation never needed the meshes at all. A gate that
 * waited forever would turn a degraded session into no session, which is a
 * strictly worse trade than letting someone in to a world that is still
 * arriving.
 */
export const ASSET_WAIT_CEILING_MS = 8_000;

/**
 * `begun` wins outright, and deliberately so: it is what makes the ceiling
 * above meaningful, and it is what stops a quality change - which disposes the
 * scene and builds a new one, unsettling its assets - from throwing the gate
 * back up over a game already in progress.
 */
export function bootPhase({
  assetsSettled,
  begun,
  awaySettled = true,
}: BootConditions): BootPhase {
  if (begun) return awaySettled ? 'playing' : 'settling';
  return assetsSettled ? 'ready' : 'preparing';
}
