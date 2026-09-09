import type { EnemyState, RunState } from '../model';
import type { SpellMechanics } from '../spell/SpellMechanics';
import type { CompiledSpell } from '../spell/types';
import { compileSpell } from '../spell/SpellCompiler';

export interface CombatPosition {
  x: number;
  z: number;
}
export interface DotState {
  baseDamage: string;
  damage: string;
  nextTickAt: number;
  expiresAt: number;
  castId: number;
  sourceInstanceId: number;
  mechanics: SpellMechanics;
}
export interface EnemyStatuses {
  dot?: DotState;
  weakness?: { stacks: number; strength: number; expiresAt: number };
  ruin?: { amplification: number; expiresAt: number };
}
export interface PendingMeteor {
  id: number;
  dueAt: number;
  position: CombatPosition;
  targetId: number;
  castId: number;
  damage: string;
  mechanics: SpellMechanics;
  infect: boolean;
}
export interface SpellCombatState {
  procSerial: number;
  meteors: PendingMeteor[];
  momentum: number;
  momentumUntil: number;
  overdriveUntil: number;
  focus: number;
  supercharge: number;
  superchargeTargetId: number | null;
  velocityStored: string;
  velocityReady: boolean;
  nextCastHaste: boolean;
}
export function createSpellCombatState(): SpellCombatState {
  return {
    procSerial: 0,
    meteors: [],
    momentum: 0,
    momentumUntil: 0,
    overdriveUntil: 0,
    focus: 0,
    supercharge: 0,
    superchargeTargetId: null,
    velocityStored: '0',
    velocityReady: false,
    nextCastHaste: false,
  };
}
export function combatState(run: RunState): SpellCombatState {
  return (run.combatState ??= createSpellCombatState());
}
export function clearSpellCombat(run: RunState): void {
  run.combatState = createSpellCombatState();
  for (const enemy of run.enemies) enemy.statuses = {};
}
export function formationSlot(index: number): CombatPosition {
  const row = Math.floor(index / 3);
  return { x: 2.4 + (index % 3) * 1.2 + row * 0.48, z: (row - 0.5) * 1.25 };
}

/**
 * Combat runs down a set of lanes. The mage holds x = 0; enemies appear at the
 * far end of a lane and close the distance before they can swing, so a fight
 * reads as something arriving rather than damage from off-screen.
 */
export function laneZ(lane: number, spacing: number): number {
  return (lane - 1) * spacing;
}

export function spawnPosition(lane: number, spacing: number, distance: number): CombatPosition {
  return { x: distance, z: laneZ(lane, spacing) };
}

/** Distance from the mage. Enemies only ever move along x. */
export function distanceToMage(enemy: EnemyState): number {
  return positionOf(enemy).x;
}

/**
 * Stopping the loop exactly on a range boundary lands the position a bit-width
 * past it - 9.000000000000002 for a reach of 9 - which reads as out of range
 * and schedules another step of 8e-16 seconds, forever. The tolerance is what
 * makes arriving at a threshold mean arrived.
 */
export const RANGE_EPSILON = 1e-9;

export function inAttackRange(enemy: EnemyState, range: number): boolean {
  return distanceToMage(enemy) <= range + RANGE_EPSILON;
}

export function anyInRange(run: RunState, range: number): boolean {
  return run.enemies.some((enemy) => inAttackRange(enemy, range));
}

/** Seconds until an out-of-range enemy arrives; Infinity if it never will. */
export function timeToRange(enemy: EnemyState, range: number, speed: number): number {
  const gap = distanceToMage(enemy) - range;
  if (gap <= RANGE_EPSILON) return 0;
  return speed > 0 ? gap / speed : Number.POSITIVE_INFINITY;
}

/**
 * The soonest any approaching enemy crosses one of the given thresholds.
 *
 * Every range that changes behaviour has to be an event the combat loop can
 * stop on - melee reach and spell reach both. Miss one and a chunked run
 * crosses it at a different moment than a single pass, and the two disagree.
 */
export function soonestRangeChange(
  run: RunState,
  ranges: readonly number[],
  speed: number,
): number {
  let soonest = Number.POSITIVE_INFINITY;
  for (const enemy of run.enemies) {
    for (const range of ranges) {
      if (inAttackRange(enemy, range)) continue;
      soonest = Math.min(soonest, timeToRange(enemy, range, speed));
    }
  }
  return soonest;
}

/**
 * Re-derives every approaching enemy's position from the authoritative clock.
 *
 * Deliberately not an accumulator: subtracting speed * dt each step makes the
 * result depend on how the run was chunked, and floating point then disagrees
 * between a single pass, a chunked pass, and a save-and-resume.
 */
export function advanceApproach(run: RunState, range: number, speed: number): void {
  if (speed <= 0) return;
  for (const enemy of run.enemies) {
    const position = enemy.position;
    if (!position) continue;

    // An enemy saved before approach existed has a position but no anchor. It
    // would then never move, never arrive, and never stop being the next event
    // the combat loop is waiting for - so adopt where it stands.
    if (enemy.approachFrom === undefined || enemy.approachSince === undefined) {
      enemy.approachFrom = position.x;
      enemy.approachSince = run.elapsedSeconds;
    }

    const travelled = speed * Math.max(0, run.elapsedSeconds - enemy.approachSince);
    position.x = Math.max(range, enemy.approachFrom - travelled);
  }
}
export function ensurePositions(run: RunState): void {
  for (const enemy of run.enemies)
    if (!enemy.position) {
      let i = 0;
      while (run.enemies.some((e) => e.position && distanceSquared(e.position, formationSlot(i)) < 0.001))
        i++;
      enemy.position = formationSlot(i);
    }
}
export function positionOf(enemy: EnemyState): CombatPosition {
  return enemy.position ?? formationSlot(0);
}
export function distanceSquared(a: CombatPosition, b: CombatPosition): number {
  return (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
}
export function nearby(
  run: RunState,
  position: CombatPosition,
  radius: number,
  exclude = new Set<number>(),
): EnemyState[] {
  return run.enemies
    .filter(
      (e) =>
        e.hp.cmp(0) > 0 &&
        !exclude.has(e.instanceId) &&
        distanceSquared(position, positionOf(e)) <= radius ** 2,
    )
    .sort(
      (a, b) =>
        distanceSquared(position, positionOf(a)) - distanceSquared(position, positionOf(b)) ||
        a.instanceId - b.instanceId,
    );
}
export function effectiveCastInterval(run: RunState, compiled?: CompiledSpell): number {
  const spell = compiled ?? compileSpell(run.spell),
    m = spell.mechanics,
    s = run.combatState;
  if (!m || !s) return spell.castInterval;
  const speed =
    s.overdriveUntil > run.elapsedSeconds
      ? m.overdriveSpeed
      : 1 + (s.momentumUntil > run.elapsedSeconds ? s.momentum * m.momentumSpeed : 0);
  return Math.max(0.01, (spell.castInterval / speed) * (s.nextCastHaste ? 0.5 : 1));
}
