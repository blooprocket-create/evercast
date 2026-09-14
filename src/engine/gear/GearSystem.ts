import type { EngineConfig } from '../config';
import type { GameEvent } from '../events/GameEvent';
import type { GameState } from '../model';
import type Decimal from 'break_eternity.js';
import { big } from '../numbers';
import { masteryMultiplier } from '../prestige/Mastery';
import {
  GEAR_COST_GROWTH,
  GEAR_DEFINITIONS,
  GEAR_POWER_GROWTH,
  GEAR_SLOT_ORDER,
  evolutionTierForLevel,
  nextEvolutionLevel,
} from './GearCatalog';
import type { EquipmentState, GearSlot } from './types';

export interface CompiledGearStats {
  baseDamageBonus: ReturnType<typeof big>;
  maxHpBonus: ReturnType<typeof big>;
}

export function createInitialEquipmentState(): EquipmentState {
  return {
    gold: big(0),
    pieces: {
      helm: { slot: 'helm', level: 1, treeNodes: [] },
      staff: { slot: 'staff', level: 1, treeNodes: [] },
      spellbook: { slot: 'spellbook', level: 1, treeNodes: [] },
      robe: { slot: 'robe', level: 1, treeNodes: [] },
      boots: { slot: 'boots', level: 1, treeNodes: [] },
      necklace: { slot: 'necklace', level: 1, treeNodes: [] },
      ringLeft: { slot: 'ringLeft', level: 1, treeNodes: [] },
      ringRight: { slot: 'ringRight', level: 1, treeNodes: [] },
    },
  };
}

/**
 * One slot of compiled stats, keyed on the eight levels that produced them.
 *
 * `compileGearStats` sits in the combat hot path: `CombatSystem` compiles once
 * per cast, `EvolvingCombat` again, and `wizardPerHit` again for each companion
 * - so it runs several times per projectile per enemy, while gear only changes
 * when the player buys a level. One slot is therefore effectively always warm,
 * and a miss costs no more than the old unconditional path did.
 *
 * Keyed on the levels rather than on the equipment's identity, because `levelUp`
 * mutates `piece.level` in place: the object a caller holds is the same one
 * before and after a purchase, so identity would never invalidate.
 */
let memoizedLevels: number[] | null = null;
let memoizedStats: CompiledGearStats | null = null;

/**
 * The gear's own contribution, and nothing else.
 *
 * This must stay a pure function of gear levels for the memo to be sound.
 * Anything that scales the mage without being gear belongs at the sites that
 * consume this result, not inside it - folding it in here would break the memo's
 * key and would also silently exclude the base terms that are added alongside
 * this result rather than to it.
 */
export function compileGearStats(equipment: EquipmentState): CompiledGearStats {
  const levels = memoizedLevels;
  const cached = memoizedStats;
  if (levels && cached && GEAR_SLOT_ORDER.every((slot, index) => equipment.pieces[slot].level === levels[index])) {
    return cached;
  }

  let baseDamageBonus = big(0);
  let maxHpBonus = big(0);

  for (const slot of GEAR_SLOT_ORDER) {
    const piece = equipment.pieces[slot];
    const definition = GEAR_DEFINITIONS[slot];
    const contribution = gearContribution(definition.statPerLevel, piece.level);
    if (definition.primaryStat === 'baseDamage') baseDamageBonus = baseDamageBonus.add(contribution);
    if (definition.primaryStat === 'maxHp') maxHpBonus = maxHpBonus.add(contribution);
  }

  // Frozen because every caller now shares one instance: the memo would turn an
  // accidental mutation from a local bug into a global one.
  const stats = Object.freeze({ baseDamageBonus, maxHpBonus });
  memoizedLevels = GEAR_SLOT_ORDER.map((slot) => equipment.pieces[slot].level);
  memoizedStats = stats;
  return stats;
}

/**
 * What a slot's levels are worth, as a geometric sum rather than a product.
 *
 * Anchored so the bottom of the curve is unchanged: level 1 contributes nothing
 * and level 2 contributes exactly `statPerLevel`, because the sum of one term of
 * a geometric series is that term. Everything above level 2 compounds, which is
 * the whole point - enemy health always did.
 */
export function gearContribution(statPerLevel: number, level: number): Decimal {
  const paidLevels = Math.max(0, level - 1);
  if (paidLevels === 0) return big(0);
  return big(GEAR_POWER_GROWTH)
    .pow(paidLevels)
    .sub(1)
    .div(GEAR_POWER_GROWTH - 1)
    .mul(statPerLevel);
}

/**
 * The level under the compounding curve worth what `oldLevel` was worth under
 * the additive one it replaced.
 *
 * Inverts `gearContribution`. `statPerLevel` cancels on the way through - old
 * power is `statPerLevel x paidLevels` and new power is
 * `statPerLevel x (G^n - 1) / (G - 1)`, so the ratio the logarithm sees is the
 * same for every slot and one map serves all eight.
 *
 * Lives here rather than in the save codec so it cannot drift from the curve it
 * inverts: the two are only correct as a pair.
 */
export function equivalentGearLevel(oldLevel: number): number {
  const paidLevels = Math.max(0, oldLevel - 1);
  if (paidLevels === 0) return 1;
  const converted =
    Math.log(paidLevels * (GEAR_POWER_GROWTH - 1) + 1) / Math.log(GEAR_POWER_GROWTH) + 1;
  return Math.max(1, Math.round(converted));
}

/**
 * Built as a Decimal before it is exponentiated, never with `Math.pow`. A double
 * saturates to Infinity somewhere past level 4,000 on this curve, and gold is a
 * Decimal precisely because the player gets that far.
 */
export function gearLevelCost(slot: GearSlot, currentLevel: number) {
  const definition = GEAR_DEFINITIONS[slot];
  const paidLevels = Math.max(0, currentLevel - 1);
  return big(definition.baseLevelCost)
    .mul(definition.costGrowth)
    .mul(big(GEAR_COST_GROWTH).pow(paidLevels))
    .floor()
    .max(1);
}

/**
 * What buying `maxLevels` more levels of a slot really costs, and how many of
 * them are actually affordable. The cost curve rises per level, so a bulk
 * purchase is not the next level's price times the count - the interface must
 * not guess at it, and the curve lives here.
 *
 * Still a loop, deliberately. A geometric curve has a closed form for both the
 * count and the total, but `gearLevelCost` floors each level and `levelUp`
 * charges those floored prices one at a time, so a closed form over unfloored
 * terms would quote a total the engine then disagrees with - and quoting under
 * what is charged makes the button buy fewer levels than it promised. The
 * geometric curve also bounds the loop by itself: affordable levels grow with
 * `log(gold)`, so the iteration count stays small at any wealth the economy can
 * actually reach.
 */
export function gearBulkPurchase(
  slot: GearSlot,
  currentLevel: number,
  maxLevels: number,
  gold: Decimal,
): { levels: number; total: Decimal } {
  let total = big(0);
  let levels = 0;
  let level = currentLevel;
  const limit = Math.min(maxLevels, GEAR_BULK_LIMIT);

  while (levels < limit) {
    const next = total.add(gearLevelCost(slot, level));
    if (next.cmp(gold) > 0) break;
    total = next;
    level += 1;
    levels += 1;
  }

  return { levels, total };
}

/** A Max purchase must terminate even when gold is effectively unbounded. */
export const GEAR_BULK_LIMIT = 10_000;

export class GearSystem {
  constructor(
    private readonly config: EngineConfig,
    private readonly emit: (event: GameEvent) => void,
  ) {}

  levelUp(state: GameState, slot: GearSlot): boolean {
    const piece = state.equipment.pieces[slot];
    const cost = gearLevelCost(slot, piece.level);
    if (state.equipment.gold.cmp(cost) < 0) return false;

    const previousTier = evolutionTierForLevel(piece.level);
    state.equipment.gold = state.equipment.gold.sub(cost);
    piece.level += 1;
    const nextTier = evolutionTierForLevel(piece.level);
    this.syncMageStats(state, true);

    this.emit({
      type: 'gear_leveled',
      time: state.run.elapsedSeconds,
      slot,
      level: piece.level,
      cost: cost.toString(),
    });

    if (nextTier > previousTier) {
      this.emit({
        type: 'gear_evolved',
        time: state.run.elapsedSeconds,
        slot,
        level: piece.level,
        evolutionTier: nextTier,
        name: GEAR_DEFINITIONS[slot].evolutionNames[nextTier],
      });
    }
    return true;
  }

  syncMageStats(state: GameState, preserveHealthGain = false): void {
    const previousMax = state.run.mage.maxHp;
    const nextMax = mageMaxHealth(state, this.config.baseMageHealth);
    const gain = nextMax.sub(previousMax);
    state.run.mage.maxHp = nextMax;
    if (preserveHealthGain && gain.cmp(0) > 0) {
      state.run.mage.hp = state.run.mage.hp.add(gain).min(nextMax);
    } else if (state.run.mage.hp.cmp(nextMax) > 0) {
      state.run.mage.hp = big(nextMax);
    }
  }
}

/**
 * The mage's maximum health: her base, plus what gear contributes, times what
 * every Rebirth so far is worth.
 *
 * One definition, because three had already started to drift - GearSystem,
 * RebirthSystem and the save codec each wrote this expression out longhand, and
 * a multiplier added to one of them would have been missing from the other two.
 * Mastery is applied here rather than inside `compileGearStats` because that has
 * to stay a pure function of gear levels to be memoizable, and because the base
 * health is not gear and would otherwise go unmultiplied.
 */
export function mageMaxHealth(state: GameState, baseMageHealth: number): Decimal {
  return big(baseMageHealth)
    .add(compileGearStats(state.equipment).maxHpBonus)
    .mul(masteryMultiplier(state.meta));
}

export function gearDisplayData(equipment: EquipmentState, slot: GearSlot) {
  const piece = equipment.pieces[slot];
  const definition = GEAR_DEFINITIONS[slot];
  const tier = evolutionTierForLevel(piece.level);
  const contribution = big(definition.statPerLevel).mul(Math.max(0, piece.level - 1));
  return {
    slot,
    level: piece.level,
    evolutionTier: tier,
    name: definition.evolutionNames[tier],
    description: definition.description,
    primaryStatLabel: definition.primaryStatLabel,
    contribution,
    nextLevelGain: gearContribution(definition.statPerLevel, piece.level + 1).sub(contribution),
    nextLevelCost: gearLevelCost(slot, piece.level),
    nextEvolutionLevel: nextEvolutionLevel(piece.level),
    unlockedTreeTier: tier + 1,
    treeNodes: [...piece.treeNodes],
  };
}
