import type { EnemyState, RunState } from '../model';
import type { CombatPosition } from './SpellCombatState';

/**
 * Where enemies plant themselves once they have closed the distance.
 *
 * The camera looks down the road from ~15 degrees above it, so z is very nearly
 * the depth axis: a full lane of separation is under 3% of screen height. What
 * actually reads as two separate bodies is x. So the slots spread mostly along
 * the road and use z for interpenetration and depth ordering, rather than the
 * other way round.
 *
 * One entry per simultaneous enemy (`maxAliveEnemies`); raising that config
 * wraps into a further rank rather than handing two enemies the same spot.
 */
export const CONTACT_SLOTS: readonly { xPad: number; z: number }[] = [
  { xPad: 0, z: 0 },
  { xPad: 0.05, z: -0.66 },
  { xPad: 0.05, z: 0.66 },
  { xPad: 0.55, z: -0.32 },
  { xPad: 0.55, z: 0.32 },
  { xPad: 0.62, z: -1.15 },
];

/** How far behind the slots an overflow rank waits. */
const RANK_DEPTH = 0.7;

/**
 * How much of the final approach an enemy spends angling out of its lane into
 * its slot. A distance rather than a fixed x, so a caster that stops at 4.6
 * turns in over the same stretch of road as a melee enemy stopping at 1.1.
 */
const CONTACT_CONVERGE = 3.4;

/** This enemy's own reach, or the engine default for a save written before them. */
export function reachOf(enemy: EnemyState, defaultReach: number): number {
  return enemy.attackRange ?? defaultReach;
}

/**
 * The spot this enemy walks to and swings from.
 *
 * Deliberately a pure function of stored fields - never of the current position
 * or of the rest of the run. The combat loop derives the stop once to schedule
 * the arrival and again to clamp the walk; if those two disagreed by so much as
 * a slot's padding the enemy would overshoot inside a step, and a chunked run
 * would part ways with a single pass.
 */
export function contactPoint(enemy: EnemyState, defaultReach: number): CombatPosition {
  const index = enemy.contactSlot ?? 0;
  const slot = CONTACT_SLOTS[index % CONTACT_SLOTS.length];
  const rank = Math.floor(index / CONTACT_SLOTS.length);
  return { x: reachOf(enemy, defaultReach) + slot.xPad + rank * RANK_DEPTH, z: slot.z };
}

/** The lowest slot no living enemy is holding, so a kill frees up the front. */
export function freeContactSlot(run: RunState): number {
  const taken = new Set(
    run.enemies.filter((e) => e.hp.cmp(0) > 0 && e.contactSlot !== undefined).map((e) => e.contactSlot),
  );
  let index = 0;
  while (taken.has(index)) index += 1;
  return index;
}

/**
 * The lane offset, faded out over the last stretch of the approach.
 *
 * Enemies still only *travel* along x - z is a pure function of x - which keeps
 * the position derived rather than accumulated. Smoothstep so there is no kink
 * at the moment the turn starts.
 */
export function convergedZ(fromZ: number, toZ: number, x: number, stopX: number): number {
  const t = Math.min(1, Math.max(0, (stopX + CONTACT_CONVERGE - x) / CONTACT_CONVERGE));
  return fromZ + (toZ - fromZ) * t * t * (3 - 2 * t);
}
