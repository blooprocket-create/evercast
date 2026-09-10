import type { EngineConfig } from '../config';
import type { GameEvent } from '../events/GameEvent';
import type { EnemyState, RunState } from '../model';
import { hasArrived } from './SpellCombatState';

/** Matches the combat loop's own tolerance for landing exactly on a beat. */
const BEAT_EPSILON = 1e-9;

/**
 * How long this enemy's swing is telegraphed before it lands.
 *
 * Capped against its own cadence as well as the config, so the quickest
 * attackers in the catalog still spend most of their interval at rest rather
 * than permanently wound up.
 */
export function windupFor(enemy: EnemyState, config: EngineConfig): number {
  return Math.min(config.enemyWindupSeconds, enemy.attackInterval * 0.4);
}

/**
 * Seconds until the next thing an enemy does - raising a weapon or landing a
 * hit with it.
 *
 * Both are events the loop has to be able to stop on. Miss the telegraph and a
 * chunked run emits it at a different moment than a single pass; miss the swing
 * and damage lands late.
 */
export function nextEnemyBeat(run: RunState, config: EngineConfig): number {
  let soonest = Number.POSITIVE_INFINITY;
  for (const enemy of run.enemies) {
    if (!hasArrived(enemy, config.enemyAttackRange)) continue;
    const due = enemy.telegraphed
      ? enemy.attackCooldown
      : enemy.attackCooldown - windupFor(enemy, config);
    soonest = Math.min(soonest, Math.max(0, due));
  }
  return soonest;
}

/** Ticks down only the enemies that have stopped walking; the rest are closing. */
export function tickEnemyCooldowns(run: RunState, config: EngineConfig, consumed: number): void {
  for (const enemy of run.enemies)
    if (hasArrived(enemy, config.enemyAttackRange)) enemy.attackCooldown -= consumed;
}

/**
 * Raises the weapons that are due and returns the swings that have landed.
 *
 * The telegraph is emitted first and separately so the renderer can start the
 * attack clip before the damage, rather than animating a blow the mage has
 * already taken.
 */
export function resolveEnemyBeats(
  run: RunState,
  config: EngineConfig,
  emit: (event: GameEvent) => void,
): EnemyState[] {
  const due: EnemyState[] = [];
  for (const enemy of run.enemies) {
    if (!hasArrived(enemy, config.enemyAttackRange)) continue;
    const windup = windupFor(enemy, config);
    if (!enemy.telegraphed && enemy.attackCooldown <= windup + BEAT_EPSILON) {
      enemy.telegraphed = true;
      emit({
        type: 'enemy_windup',
        time: run.elapsedSeconds,
        instanceId: enemy.instanceId,
        durationSeconds: Math.max(0, enemy.attackCooldown),
      });
    }
    if (enemy.attackCooldown <= BEAT_EPSILON) due.push(enemy);
  }
  return due;
}
