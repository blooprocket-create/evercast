import Decimal from 'break_eternity.js';
import type { EquipmentState } from './gear/types';
import type { SpellBuild } from './spell/types';
import type { SpellTreeState } from './spellTree/types';

export type RunMode = 'push' | 'farm';
export type CombatPhase = 'travel' | 'combat';

export interface MageState {
  hp: Decimal;
  maxHp: Decimal;
}

export interface EnemyState {
  instanceId: number;
  definitionId: string;
  name: string;
  stage: number;
  boss: boolean;
  hp: Decimal;
  maxHp: Decimal;
  attackDamage: Decimal;
  attackInterval: number;
  attackCooldown: number;
  reward: Decimal;
}

export interface EncounterState {
  stage: number;
  totalEnemies: number;
  spawnedEnemies: number;
  spawnInterval: number;
  spawnCooldown: number;
  maxAlive: number;
  bossStage: boolean;
}

export interface RunStatistics {
  casts: number;
  projectileHits: number;
  criticalHits: number;
  kills: number;
  deaths: number;
  bossKills: number;
}

export interface RunState {
  elapsedSeconds: number;
  frontierStage: number;
  highestStageThisRun: number;
  encounterStage: number;
  zoneNumber: number;
  zoneName: string;
  mode: RunMode;
  farmStage: number;
  farmKillsSinceFailure: number;
  phase: CombatPhase;
  travelElapsed: number;
  castCooldown: number;
  essence: Decimal;
  mage: MageState;
  enemies: EnemyState[];
  encounter: EncounterState | null;
  nextEnemyInstanceId: number;
  spell: SpellBuild;
  stats: RunStatistics;
}

export interface MetaState {
  rebirths: number;
  knowledge: Decimal;
  highestStageEver: number;
  lifetimeKills: number;
  storyFlags: string[];
  unlockedSystems: string[];
}

export interface GameState {
  run: RunState;
  meta: MetaState;
  equipment: EquipmentState;
  spellTree: SpellTreeState;
}
