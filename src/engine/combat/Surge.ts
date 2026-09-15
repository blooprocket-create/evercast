// prettier-ignore
import { COUNTER_MAX_CHARGES, COUNTER_RECHARGE_SECONDS, STAGGER_AMPLIFICATION, STAGGER_SECONDS, SURGE_EVERY, SURGE_OFFSET, SURGE_WINDUP_CADENCE_SHARE, SURGE_WINDUP_SECONDS } from '../../content/combatTuning';
import type { GameEvent } from '../events/GameEvent';
import type { EnemyState, RunState } from '../model';
import { hasArrived } from './SpellCombatState';

/**
 * The Surge, and the one thing the player does about it.
 *
 * Every other decision in Evercast is made in a menu and then watched. This is
 * the exception, and the rule it is built to is worth stating before any of the
 * arithmetic below:
 *
 * **A Surge replaces a boss swing. It never adds one.**
 *
 * A Surge lands for the boss's ordinary damage, at the ordinary moment its
 * cooldown was already going to bring it - the *only* thing it changes is how
 * long the blow is telegraphed first. So a player who is away, or who never
 * discovers the mechanic at all, faces exactly the boss they faced before this
 * module existed, and a player who is present gets something better than that.
 *
 * That asymmetry is deliberate and it is not negotiable. This is an idle game:
 * a mechanic that made absence worse would be a tax dressed as a feature, and
 * it would be collected mostly from the players who like the genre most.
 */

/** Matches the combat loop's own tolerance for landing exactly on a beat. */
const BEAT_EPSILON = 1e-9;

export interface CounterspellState {
  charges: number;
  /** Seconds until the next charge lands. Meaningless while charges are full. */
  recharge: number;
}

export function createCounterspellState(): CounterspellState {
  return { charges: COUNTER_MAX_CHARGES, recharge: COUNTER_RECHARGE_SECONDS };
}

export function counterspellState(run: RunState): CounterspellState {
  return (run.counter ??= createCounterspellState());
}

/**
 * Whether this enemy's *next* swing is a Surge.
 *
 * Derived from the swing count rather than stored as a flag, which is what lets
 * offline catch-up, a chunked run and a resumed save agree about it without any
 * of them having to replay the fight. `telegraphed` is stored precisely because
 * it means something different - that the renderer was told - and is therefore
 * cleared whenever the presentation that heard it is gone.
 */
export function isSurgeSwing(enemy: EnemyState): boolean {
  if (!enemy.boss) return false;
  return (enemy.swings ?? 0) % SURGE_EVERY === SURGE_OFFSET % SURGE_EVERY;
}

/**
 * How long a Surge is telegraphed.
 *
 * Held under the boss's own cadence so the telegraph cannot outlast the swing
 * it announces - a window longer than the interval would mean the boss was
 * winding up from the instant the last blow landed, which reads as a stuck
 * animation rather than as a threat being raised.
 */
export function surgeWindup(enemy: EnemyState): number {
  return Math.min(SURGE_WINDUP_SECONDS, enemy.attackInterval * SURGE_WINDUP_CADENCE_SHARE);
}

/**
 * The boss whose Surge is in the air right now, if one is.
 *
 * Read off the cooldown rather than off `telegraphed`, so whether the counter
 * is legal is a pure function of simulation state. Keying it to the renderer's
 * flag would make the command legal or illegal depending on whether anything
 * had been drawing - which is exactly the kind of thing that is fine until a
 * save is resumed, and then is not.
 */
export function surgingEnemy(run: RunState, defaultReach: number): EnemyState | undefined {
  return run.enemies.find(
    (enemy) =>
      enemy.hp.cmp(0) > 0 &&
      isSurgeSwing(enemy) &&
      hasArrived(enemy, defaultReach) &&
      enemy.attackCooldown > BEAT_EPSILON &&
      enemy.attackCooldown <= surgeWindup(enemy) + BEAT_EPSILON,
  );
}

/** Extra damage a staggered enemy is taking, as a plain multiplier. */
export function staggerMultiplier(run: RunState, enemy: EnemyState): number {
  const stagger = enemy.statuses?.stagger;
  return stagger && stagger.expiresAt > run.elapsedSeconds ? 1 + stagger.amplification : 1;
}

/**
 * Hands charges back over time.
 *
 * Not a gate the combat loop has to stop on: a charge arriving changes what the
 * player *may* do and never what the simulation *will* do, so nothing about the
 * world branches on it and it can be settled by subtraction. The loop stays as
 * it was, which matters more here than the tidiness of scheduling it - every
 * new event source in `nextAction` is a new way for a chunked run and a single
 * pass to disagree.
 */
export function tickCounterspell(run: RunState, seconds: number): void {
  const counter = counterspellState(run);
  if (counter.charges >= COUNTER_MAX_CHARGES) {
    counter.recharge = COUNTER_RECHARGE_SECONDS;
    return;
  }
  counter.recharge -= seconds;
  // A single long step - offline catch-up, or a slow frame - can be worth more
  // than one charge. Bounded by the cap, so an absence of any length costs the
  // same handful of iterations.
  while (counter.recharge <= 0 && counter.charges < COUNTER_MAX_CHARGES) {
    counter.charges += 1;
    counter.recharge += COUNTER_RECHARGE_SECONDS;
  }
  if (counter.charges >= COUNTER_MAX_CHARGES) counter.recharge = COUNTER_RECHARGE_SECONDS;
}

export interface CounterOutcome {
  instanceId: number;
  chargesLeft: number;
  staggerSeconds: number;
}

/**
 * Spends a charge to break the Surge in the air.
 *
 * Returns what happened, or `undefined` when there was nothing to break or
 * nothing to break it with - the same shape every other refused command in the
 * engine has, so the interface can reflect a rejection without reimplementing
 * the rule.
 *
 * This is the only command in the engine with a *deadline*. Everything else
 * `execute` accepts is a purchase that is equally legal a minute later; this
 * one is legal for exactly as long as the Surge is in the air, which is the
 * whole point of it. So legality is settled here, against the boss's own
 * cooldown, rather than against anything the interface believes about what it
 * last drew - a button that stayed enabled a frame too long must be refused,
 * not honoured.
 */
export function breakSurge(
  run: RunState,
  defaultReach: number,
  emit: (event: GameEvent) => void,
): CounterOutcome | undefined {
  const enemy = surgingEnemy(run, defaultReach);
  if (!enemy) return undefined;
  const counter = counterspellState(run);
  if (counter.charges < 1) return undefined;

  counter.charges -= 1;
  // The swing is cancelled rather than delayed, so the cooldown is pushed out
  // by a whole interval and the count advances: without the increment the very
  // next swing would satisfy the Surge cycle again and the boss would wind up
  // forever while charges lasted.
  enemy.attackCooldown += enemy.attackInterval;
  enemy.swings = (enemy.swings ?? 0) + 1;
  enemy.telegraphed = false;

  const statuses = (enemy.statuses ??= {});
  statuses.stagger = {
    amplification: STAGGER_AMPLIFICATION,
    expiresAt: run.elapsedSeconds + STAGGER_SECONDS,
  };

  emit({
    type: 'surge_broken',
    time: run.elapsedSeconds,
    instanceId: enemy.instanceId,
    staggerSeconds: STAGGER_SECONDS,
    chargesLeft: counter.charges,
  });

  return {
    instanceId: enemy.instanceId,
    chargesLeft: counter.charges,
    staggerSeconds: STAGGER_SECONDS,
  };
}
