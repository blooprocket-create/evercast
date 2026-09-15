/**
 * The two curves that make a body move like a body rather than like a slideshow.
 *
 * Both are pure, and separated from the thing that applies them for the same
 * reason `ImpactPlan` is: the shape of a cross-fade and the shape of a recoil
 * are judgements worth testing, and neither of them needs a renderer or a
 * loaded GLB to be wrong in a way anyone can see.
 */

/**
 * How long a transition between two clips takes.
 *
 * Short enough that an attack still reads as sudden, long enough that the
 * shoulder does not teleport. A flinch is faster than everything else, because
 * the whole point of a flinch is that it is abrupt; settling back to idle is
 * slower, because that is the one transition nobody is meant to notice.
 */
export const CROSS_FADE = {
  attack: 0.075,
  hit: 0.05,
  death: 0.11,
  idle: 0.17,
  walk: 0.13,
} as const;

/**
 * How much of the *previous* pose is still showing, 1 down to 0.
 *
 * Smoothstepped rather than linear: a linear cross-fade starts and stops with
 * a velocity discontinuity at both ends, which on a limb reads as a small jerk
 * at each end of the blend - two pops in place of the one it was removing.
 *
 * Exactly 0 once the blend is spent, so a settled actor is bit-for-bit the clip
 * and not the clip plus an epsilon of something it used to be doing.
 */
export function crossFadeWeight(remaining: number, total: number): number {
  if (!(total > 0) || !(remaining > 0)) return 0;
  const t = Math.min(1, remaining / total);
  return t * t * (3 - 2 * t);
}

/**
 * A struck body, as a multiplier on the direction it was struck from.
 *
 * `elapsed` runs 0 to 1 across the impulse. The shape is a fast throw out and a
 * damped return that crosses zero once - the overshoot is what separates a body
 * absorbing a blow from a body being translated by one, and it is the whole
 * difference between this and a linear fade back to the rest pose.
 *
 * Returns to exactly 0 at the end, because anything else leaves an actor
 * permanently a few millimetres off its own feet after a long fight.
 */
export function impulseAmount(elapsed: number): number {
  if (!(elapsed > 0)) return 0;
  if (elapsed >= 1) return 0;
  // Out in the first fifth, back through zero, settling by the end.
  const decay = (1 - elapsed) * (1 - elapsed);
  return Math.sin(elapsed * Math.PI * 1.5) * decay;
}

/**
 * How hard a hit throws the thing it lands on.
 *
 * Damage is not the input, and deliberately: an incremental game's numbers run
 * to twenty digits, so anything scaled by them saturates within an hour and
 * every hit for the rest of the run looks identical. What is left is the two
 * facts that stay true at every stage - whether it was a critical, and whether
 * the thing being hit is a boss, which should barely rock at all.
 */
export function impulseStrength(options: { critical?: boolean; boss?: boolean }): number {
  const base = options.critical ? 0.2 : 0.11;
  return options.boss ? base * 0.45 : base;
}
