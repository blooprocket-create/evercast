import type Decimal from 'break_eternity.js';
import { compileGearStats } from '../gear/GearSystem';
import type { EquipmentState } from '../gear/types';
import type { GameEvent } from '../events/GameEvent';
import type { CompanionCombatant, CompanionAbilityId } from './types';
import type { EnemyState, RunState } from '../model';
import { big } from '../numbers';
import { compileSpell } from '../spell/SpellCompiler';
import { inAttackRange, livingByDistance } from '../combat/SpellCombatState';
// prettier-ignore
import { abilityMagnitude, companionDamage, requireCompanion } from './CompanionCatalog';
import { companionIndices, reachThreshold } from './Formation';

/** Matches the combat loop's own tolerance for landing exactly on a beat. */
const BEAT_EPSILON = 1e-9;

/** Guard can blunt a wave; it can never make the party immune to one. */
const MAX_GUARD_REDUCTION = 0.75;

/** How many enemies a volley reaches. */
const VOLLEY_TARGETS = 3;

/** Weakness and ruin applied by a companion hold for this long. */
const COMPANION_STATUS_SECONDS = 6;

/**
 * Abilities that are simply true while their owner is standing. They are never
 * scheduled as a beat: a cooldown of zero would put a due action at t=0 on
 * every pass, and the loop would consume no time and spin forever.
 */
const PASSIVE_ABILITIES: readonly CompanionAbilityId[] = ['guard'];

export function isPassive(ability: CompanionAbilityId): boolean {
  return PASSIVE_ABILITIES.includes(ability);
}

export interface CompanionBeatContext {
  run: RunState;
  equipment: EquipmentState;
  emit: (event: GameEvent) => void;
}

/**
 * What the mage hits for per projectile. Companion power is a share of this,
 * which is what keeps a five-star mythical worth the same at stage 10 and at
 * stage 10,000.
 *
 * The single definition, used by combat and by the snapshot the Companions
 * surface reads. They were computed separately and the charged route was in one
 * and not the other, so companions quietly hit for less than the interface
 * said. Anything that scales off the mage's damage belongs here.
 */
export function wizardPerHit(run: RunState, equipment: EquipmentState): Decimal {
  const spell = compileSpell(run.spell);
  const base = big(spell.damage).add(compileGearStats(equipment).baseDamageBonus);
  return spell.mechanics?.chargedCast ? base.mul(spell.mechanics.chargedDamage) : base;
}

/** Whether this companion has anything it could act on from where it stands. */
function engaged(run: RunState, companion: CompanionCombatant, threshold: number): boolean {
  if (companion.downed) return false;
  return run.enemies.some((enemy) => enemy.hp.cmp(0) > 0 && inAttackRange(enemy, threshold));
}

/** Each standing companion's reach, as an enemy x, keyed by party slot. */
function thresholds(run: RunState): Map<number, number> {
  const indices = companionIndices(run);
  return new Map(
    run.companions.map((companion) => [
      companion.slot,
      reachThreshold(companion.definitionId, indices.get(companion.slot) ?? 0),
    ]),
  );
}

/**
 * Seconds until the next thing a companion does.
 *
 * Every one of these has to be an event the loop can stop on, for exactly the
 * reason `nextEnemyBeat` does: miss one and a chunked run lands the blow at a
 * different moment than a single pass, and the two disagree forever after.
 */
export function nextCompanionBeat(run: RunState): number {
  const reach = thresholds(run);
  let soonest = Number.POSITIVE_INFINITY;
  for (const companion of run.companions) {
    if (!engaged(run, companion, reach.get(companion.slot) ?? 0)) continue;
    soonest = Math.min(soonest, Math.max(0, companion.attackCooldown));
    const ability = requireCompanion(companion.definitionId).ability;
    if (!isPassive(ability.id) && ability.cooldown > 0) {
      soonest = Math.min(soonest, Math.max(0, companion.abilityCooldown));
    }
  }
  return soonest;
}

/**
 * Ticks only the companions that could actually be acting.
 *
 * The mirror of `tickEnemyCooldowns`, and there for the same reason: a
 * companion that banked cooldown through the whole approach would unload its
 * entire rotation the instant the first enemy stepped into reach.
 */
export function tickCompanionCooldowns(run: RunState, consumed: number): void {
  const reach = thresholds(run);
  for (const companion of run.companions) {
    if (!engaged(run, companion, reach.get(companion.slot) ?? 0)) continue;
    companion.attackCooldown -= consumed;
    companion.abilityCooldown -= consumed;
  }
}

/**
 * Resolves every companion action that has come due, and reports the enemies
 * they killed so the caller can collect them the way it collects the mage's.
 */
export function resolveCompanionBeats(context: CompanionBeatContext): number[] {
  const { run, equipment, emit } = context;
  if (run.companions.length === 0) return [];

  const reach = thresholds(run);
  const perHit = wizardPerHit(run, equipment);
  const killed = new Set<number>();

  for (const companion of run.companions) {
    const threshold = reach.get(companion.slot) ?? 0;
    if (!engaged(run, companion, threshold)) continue;
    const definition = requireCompanion(companion.definitionId);

    if (companion.attackCooldown <= BEAT_EPSILON) {
      attack(run, companion, perHit, threshold, emit, killed);
      companion.attackCooldown += definition.attackInterval;
    }

    const ability = definition.ability;
    if (!isPassive(ability.id) && ability.cooldown > 0 && companion.abilityCooldown <= BEAT_EPSILON) {
      useAbility(run, companion, perHit, threshold, emit, killed);
      companion.abilityCooldown += ability.cooldown;
    }
  }

  return [...killed];
}

function nearestInReach(run: RunState, threshold: number): EnemyState | undefined {
  return livingByDistance(run).find((enemy) => inAttackRange(enemy, threshold));
}

function amplified(run: RunState, enemy: EnemyState, damage: Decimal): Decimal {
  const ruin = enemy.statuses?.ruin;
  return ruin && ruin.expiresAt > run.elapsedSeconds ? damage.mul(1 + ruin.amplification) : damage;
}

/** The party-wide damage buff a rally has raised, if one is still running. */
export function rallyMultiplier(run: RunState): number {
  const aura = run.companionAura;
  return aura && aura.rallyUntil > run.elapsedSeconds ? 1 + aura.rallyAmount : 1;
}

function hurt(
  run: RunState,
  enemy: EnemyState,
  damage: Decimal,
  killed: Set<number>,
): Decimal {
  const dealt = amplified(run, enemy, damage);
  const actual = dealt.cmp(enemy.hp) > 0 ? big(enemy.hp) : dealt;
  enemy.hp = enemy.hp.sub(actual);
  if (enemy.hp.cmp(0) <= 0) killed.add(enemy.instanceId);
  return actual;
}

function attack(
  run: RunState,
  companion: CompanionCombatant,
  perHit: Decimal,
  threshold: number,
  emit: (event: GameEvent) => void,
  killed: Set<number>,
): void {
  const target = nearestInReach(run, threshold);
  if (!target) return;
  const definition = requireCompanion(companion.definitionId);
  const damage = companionDamage(definition, companion.stars, perHit).mul(rallyMultiplier(run));
  const actual = hurt(run, target, damage, killed);

  emit({
    type: 'companion_attack',
    time: run.elapsedSeconds,
    slot: companion.slot,
    definitionId: companion.definitionId,
    instanceId: target.instanceId,
    damage: actual.toString(),
    critical: false,
  });
}

function useAbility(
  run: RunState,
  companion: CompanionCombatant,
  perHit: Decimal,
  threshold: number,
  emit: (event: GameEvent) => void,
  killed: Set<number>,
): void {
  const definition = requireCompanion(companion.definitionId);
  const ability = definition.ability;
  const magnitude = abilityMagnitude(definition, companion.stars);
  const targets: number[] = [];
  const hits: { instanceId: number; damage: string }[] = [];
  let amount = big(0);

  switch (ability.id) {
    case 'strike': {
      const target = nearestInReach(run, threshold);
      if (!target) return;
      amount = hurt(run, target, perHit.mul(magnitude).mul(rallyMultiplier(run)), killed);
      targets.push(target.instanceId);
      hits.push({ instanceId: target.instanceId, damage: amount.toString() });
      break;
    }
    case 'volley': {
      const reachable = livingByDistance(run)
        .filter((enemy) => inAttackRange(enemy, threshold))
        .slice(0, VOLLEY_TARGETS);
      if (reachable.length === 0) return;
      for (const enemy of reachable) {
        const dealt = hurt(run, enemy, perHit.mul(magnitude).mul(rallyMultiplier(run)), killed);
        amount = amount.add(dealt);
        targets.push(enemy.instanceId);
        hits.push({ instanceId: enemy.instanceId, damage: dealt.toString() });
      }
      break;
    }
    case 'echo': {
      // Not a proc on the mage's cast: a chance to duplicate would need a hook
      // inside her damage pipeline and a second RNG stream through it. A timed
      // echo reads the same on screen and stays a pure function of the clock.
      const target = nearestInReach(run, threshold);
      if (!target) return;
      amount = hurt(run, target, perHit.mul(magnitude).mul(rallyMultiplier(run)), killed);
      targets.push(target.instanceId);
      hits.push({ instanceId: target.instanceId, damage: amount.toString() });
      break;
    }
    case 'hex': {
      const target = nearestInReach(run, threshold);
      if (!target) return;
      const statuses = (target.statuses ??= {});
      const previous = statuses.weakness;
      const carried =
        previous && previous.expiresAt > run.elapsedSeconds ? previous.stacks : 0;
      statuses.weakness = {
        stacks: Math.min(3, carried + 1),
        strength: Math.max(
          previous && previous.expiresAt > run.elapsedSeconds ? previous.strength : 0,
          magnitude,
        ),
        expiresAt: run.elapsedSeconds + COMPANION_STATUS_SECONDS,
      };
      targets.push(target.instanceId);
      break;
    }
    case 'wither': {
      const target = nearestInReach(run, threshold);
      if (!target) return;
      const statuses = (target.statuses ??= {});
      statuses.ruin = {
        amplification: magnitude,
        expiresAt: run.elapsedSeconds + COMPANION_STATUS_SECONDS,
      };
      targets.push(target.instanceId);
      break;
    }
    case 'mend': {
      const wounded = lowestHealth(run);
      if (!wounded) return;
      amount = heal(run, wounded, run.mage.maxHp.mul(magnitude));
      targets.push(slotOf(wounded));
      break;
    }
    case 'bulwark': {
      const ally = lowestHealth(run) ?? { kind: 'companion' as const, companion };
      if (ally.kind === 'mage') return; // The mage has no shield of her own.
      const shield = ally.companion.maxHp.mul(magnitude);
      const held = ally.companion.shield;
      // A fresh bulwark replaces a thinner one rather than stacking forever.
      ally.companion.shield = held && held.cmp(shield) > 0 ? held : shield;
      amount = shield;
      targets.push(ally.companion.slot);
      break;
    }
    case 'rally': {
      run.companionAura = {
        rallyAmount: magnitude,
        rallyUntil: run.elapsedSeconds + ability.cooldown * 0.6,
      };
      amount = big(magnitude);
      break;
    }
    case 'revive': {
      if (companion.revivedThisEncounter) return;
      const fallen = run.companions.find((entry) => entry.downed);
      if (!fallen) return;
      companion.revivedThisEncounter = true;
      fallen.downed = false;
      fallen.hp = fallen.maxHp.mul(magnitude).min(fallen.maxHp);
      amount = fallen.hp;
      targets.push(fallen.slot);
      emit({
        type: 'companion_revived',
        time: run.elapsedSeconds,
        slot: fallen.slot,
        definitionId: fallen.definitionId,
      });
      break;
    }
    case 'guard':
      return; // Passive; never scheduled.
  }

  emit({
    type: 'companion_ability',
    time: run.elapsedSeconds,
    slot: companion.slot,
    definitionId: companion.definitionId,
    ability: ability.id,
    amount: amount.toString(),
    targets,
    hits,
  });
}

type Ally = { kind: 'mage' } | { kind: 'companion'; companion: CompanionCombatant };

function slotOf(ally: Ally): number {
  return ally.kind === 'mage' ? -1 : ally.companion.slot;
}

/** The ally in the most trouble, by fraction of maximum health. */
function lowestHealth(run: RunState): Ally | undefined {
  let best: Ally | undefined;
  let bestFraction = 1;

  if (run.mage.maxHp.cmp(0) > 0) {
    const fraction = run.mage.hp.div(run.mage.maxHp).toNumber();
    if (fraction < 1) {
      best = { kind: 'mage' };
      bestFraction = fraction;
    }
  }
  for (const companion of run.companions) {
    if (companion.downed || companion.maxHp.cmp(0) <= 0) continue;
    const fraction = companion.hp.div(companion.maxHp).toNumber();
    if (fraction < bestFraction) {
      best = { kind: 'companion', companion };
      bestFraction = fraction;
    }
  }
  return best;
}

function heal(run: RunState, ally: Ally, amount: Decimal): Decimal {
  if (ally.kind === 'mage') {
    const before = big(run.mage.hp);
    run.mage.hp = run.mage.hp.add(amount).min(run.mage.maxHp);
    return run.mage.hp.sub(before);
  }
  const before = big(ally.companion.hp);
  ally.companion.hp = ally.companion.hp.add(amount).min(ally.companion.maxHp);
  return ally.companion.hp.sub(before);
}

/**
 * The share of incoming damage the standing guards turn aside.
 *
 * Capped, because a party of five vanguards adding up to total immunity would
 * end the game rather than win the fight.
 */
export function guardReduction(run: RunState): number {
  let total = 0;
  for (const companion of run.companions) {
    if (companion.downed) continue;
    const definition = requireCompanion(companion.definitionId);
    if (definition.ability.id !== 'guard') continue;
    total += abilityMagnitude(definition, companion.stars);
  }
  return Math.min(MAX_GUARD_REDUCTION, total);
}

/**
 * Lands a blow on a companion, spending any shield first. Returns whether the
 * blow put it down.
 */
export function damageCompanion(
  run: RunState,
  companion: CompanionCombatant,
  damage: Decimal,
  emit: (event: GameEvent) => void,
  instanceId: number,
): boolean {
  let remaining = damage;
  let absorbed = big(0);
  const shield = companion.shield;
  if (shield && shield.cmp(0) > 0) {
    absorbed = shield.cmp(remaining) > 0 ? remaining : shield;
    companion.shield = shield.sub(absorbed);
    remaining = remaining.sub(absorbed);
  }

  const actual = remaining.cmp(companion.hp) > 0 ? big(companion.hp) : remaining;
  companion.hp = companion.hp.sub(actual);
  emit({
    type: 'companion_damaged',
    time: run.elapsedSeconds,
    slot: companion.slot,
    instanceId,
    // What the health bar will actually move by, not what was swung. A blow a
    // bulwark ate whole moved nothing, and a number saying otherwise over a
    // bar that does not budge reads as a bug in the fight.
    damage: actual.toString(),
    absorbed: absorbed.toString(),
  });

  if (companion.hp.cmp(0) > 0) return false;
  companion.hp = big(0);
  companion.downed = true;
  companion.shield = undefined;
  emit({
    type: 'companion_downed',
    time: run.elapsedSeconds,
    slot: companion.slot,
    definitionId: companion.definitionId,
  });
  return true;
}
