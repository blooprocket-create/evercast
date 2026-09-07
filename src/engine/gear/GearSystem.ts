import type { EngineConfig } from '../config';
import type { GameEvent } from '../events/GameEvent';
import type { GameState } from '../model';
import { big } from '../numbers';
import { GEAR_DEFINITIONS, GEAR_SLOT_ORDER, evolutionTierForLevel, nextEvolutionLevel } from './GearCatalog';
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

export function compileGearStats(equipment: EquipmentState): CompiledGearStats {
  let baseDamageBonus = big(0);
  let maxHpBonus = big(0);

  for (const slot of GEAR_SLOT_ORDER) {
    const piece = equipment.pieces[slot];
    const definition = GEAR_DEFINITIONS[slot];
    const paidLevels = Math.max(0, piece.level - 1);
    const contribution = big(definition.statPerLevel).mul(paidLevels);
    if (definition.primaryStat === 'baseDamage') baseDamageBonus = baseDamageBonus.add(contribution);
    if (definition.primaryStat === 'maxHp') maxHpBonus = maxHpBonus.add(contribution);
  }

  return { baseDamageBonus, maxHpBonus };
}

export function gearLevelCost(slot: GearSlot, currentLevel: number) {
  const definition = GEAR_DEFINITIONS[slot];
  return big(Math.floor(definition.baseLevelCost + Math.pow(Math.max(1, currentLevel), 1.35) * definition.costGrowth));
}

export function goldRewardForKill(stage: number, boss: boolean) {
  return big(Math.max(1, Math.floor(stage * (boss ? 5 : 1))));
}

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
    const compiled = compileGearStats(state.equipment);
    const previousMax = state.run.mage.maxHp;
    const nextMax = big(this.config.baseMageHealth).add(compiled.maxHpBonus);
    const gain = nextMax.sub(previousMax);
    state.run.mage.maxHp = nextMax;
    if (preserveHealthGain && gain.cmp(0) > 0) {
      state.run.mage.hp = state.run.mage.hp.add(gain).min(nextMax);
    } else if (state.run.mage.hp.cmp(nextMax) > 0) {
      state.run.mage.hp = big(nextMax);
    }
  }
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
    perLevel: definition.statPerLevel,
    nextLevelCost: gearLevelCost(slot, piece.level),
    nextEvolutionLevel: nextEvolutionLevel(piece.level),
    unlockedTreeTier: tier + 1,
    treeNodes: [...piece.treeNodes],
  };
}
