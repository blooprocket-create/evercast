import type { GearSlot } from './gear/types';
import type { QuantitySnapshot } from './numbers';
import type { RunMode } from './model';

export interface GearSnapshot {
  slot: GearSlot;
  name: string;
  level: number;
  evolutionTier: number;
  description: string;
  primaryStatLabel: string;
  contribution: QuantitySnapshot;
  perLevel: number;
  nextLevelCost: QuantitySnapshot;
  nextEvolutionLevel: number | null;
  unlockedTreeTier: number;
  treeNodes: string[];
}

export interface SimulationSnapshot {
  elapsedSeconds: number;
  stage: number;
  encounterStage: number;
  zone: number;
  zoneName: string;
  mode: RunMode;
  farmStage: number;
  farmKillsSinceFailure: number;
  essence: QuantitySnapshot;
  knowledge: QuantitySnapshot;
  gold: QuantitySnapshot;
  mageHp: QuantitySnapshot;
  mageMaxHp: QuantitySnapshot;
  mageHpPercent: number;
  enemyHp: QuantitySnapshot;
  enemyMaxHp: QuantitySnapshot;
  enemyHpPercent: number;
  enemyName: string;
  phase: 'travel' | 'combat';
  boss: boolean;
  casts: number;
  kills: number;
  deaths: number;
  projectileCount: number;
  damagePerProjectile: QuantitySnapshot;
  spellBaseDamage: QuantitySnapshot;
  gearDamageBonus: QuantitySnapshot;
  gearHealthBonus: QuantitySnapshot;
  castInterval: number;
  progressToNextEncounter: number;
  highestStageEver: number;
  rebirths: number;
  canRebirth: boolean;
  gear: GearSnapshot[];
  lastEvent: string;
}

export type EngineCommand =
  | { type: 'retry_frontier' }
  | { type: 'set_spell_build'; build: import('./spell/types').SpellBuild }
  | { type: 'level_gear'; slot: GearSlot }
  | { type: 'rebirth' };
