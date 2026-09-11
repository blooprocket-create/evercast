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

/** Clear space two resting bodies need between them; they are ~0.3 in radius. */
const MIN_CONTACT_GAP = 0.6;

/** How far the search will queue enemies back before it gives up and stacks them. */
const SLOT_SEARCH_LIMIT = CONTACT_SLOTS.length * 4;

/**
 * How much of the final approach an enemy spends angling out of its lane into
 * its slot. A distance rather than a fixed x, so a caster that stops at 4.6
 * turns in over the same stretch of road as a melee enemy stopping at 1.1.
 */
const CONTACT_CONVERGE = 3.4;

/**
 * This enemy's own reach, or the engine default for a save written before them,
 * plus whatever standoff it committed to at spawn.
 *
 * The standoff is what makes room for a front rank of companions: without it a
 * wave walks to ~1.1 from the mage and stands inside them. It is read from a
 * stored field rather than from the live party on purpose - `contactPoint` is
 * derived twice per step, and a stop that moved when a tank fell would put a
 * chunked run and a single pass on different coordinates.
 */
export function reachOf(enemy: EnemyState, defaultReach: number): number {
  return (enemy.attackRange ?? defaultReach) + (enemy.frontlineOffset ?? 0);
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
  return slotPoint(enemy.contactSlot ?? 0, reachOf(enemy, defaultReach));
}

/** Where a slot puts an enemy that reaches this far. */
function slotPoint(index: number, reach: number): CombatPosition {
  const slot = CONTACT_SLOTS[index % CONTACT_SLOTS.length];
  const rank = Math.floor(index / CONTACT_SLOTS.length);
  return { x: reach + slot.xPad + rank * RANK_DEPTH, z: slot.z };
}

export function distanceSquared(a: CombatPosition, b: CombatPosition): number {
  return (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
}

/**
 * The first slot whose resting place clears everything already standing there.
 *
 * It compares resolved points rather than slot indices, which is what makes it
 * hold for a wave of mixed reach. The table's own spacing only separates
 * enemies that reach the same distance: a boss reaching 1.6 comes to rest 0.32
 * from where a second-rank add reaching 1.1 would, so on a boss stage the two
 * would stand inside each other. Slots free on death, so a kill opens the front
 * up again.
 */
export function freeContactSlot(run: RunState, reach: number, defaultReach: number): number {
  const taken = run.enemies
    .filter((e) => e.hp.cmp(0) > 0 && e.contactSlot !== undefined)
    .map((e) => contactPoint(e, defaultReach));
  for (let index = 0; index < SLOT_SEARCH_LIMIT; index += 1) {
    const point = slotPoint(index, reach);
    if (taken.every((other) => distanceSquared(point, other) >= MIN_CONTACT_GAP ** 2)) return index;
  }
  // Further back than anything else on the road. `maxAliveEnemies` would have to
  // grow several times over before a wave could exhaust the search.
  return SLOT_SEARCH_LIMIT;
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
