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

export interface EnemySnapshot {
  instanceId: number;
  name: string;
  boss: boolean;
  hp: QuantitySnapshot;
  maxHp: QuantitySnapshot;
  hpPercent: number;
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
  enemies: EnemySnapshot[];
  encounterTotalEnemies: number;
  encounterSpawnedEnemies: number;
  encounterAliveEnemies: number;
  spawnInterval: number;
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
  critChance: number;
  critMultiplier: number;
  pierceTargets: number;
  splashTargets: number;
  splashDamageMultiplier: number;
  chainTargets: number;
  chainDamageMultiplier: number;
  controlDelaySeconds: number;
  leechFraction: number;
  spellTreePurchasedPoints: number;
  spellTreeTotalPoints: number;
  spellTreeUnspentPoints: number;
  nextSpellPointCost: QuantitySnapshot;
  activeSpellNodeIds: string[];
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
  | { type: 'buy_spell_point' }
  | { type: 'activate_spell_node'; nodeId: string }
  | { type: 'respec_spell_tree' }
  | { type: 'rebirth' };
