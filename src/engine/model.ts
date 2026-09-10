import Decimal from 'break_eternity.js';
import type { EquipmentState } from './gear/types';
import type { SpellBuild } from './spell/types';
import type { SpellTreeState } from './spellTree/types';
import type { CombatPosition, EnemyStatuses, SpellCombatState } from './combat/SpellCombatState';

export type RunMode = 'push' | 'farm';
export type CombatPhase = 'travel' | 'combat';

export interface MageState {
  hp: Decimal;
  maxHp: Decimal;
}

export interface EnemyState {
  position?: CombatPosition;
  statuses?: EnemyStatuses;
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
  /**
   * How close this enemy plants itself, copied from its definition at spawn the
   * way `attackInterval` is. Absent on a save written before per-enemy reach,
   * which falls back to the engine default.
   */
  attackRange?: number;
  /** Which spot around the mage it walked to, so a wave presses in rather than
   * stacking six bodies on one coordinate. */
  contactSlot?: number;
  /** Whether its next swing has already been telegraphed to the renderer. */
  telegraphed?: boolean;
  /**
   * Where the enemy entered from, and the clock reading when it did. Position
   * is derived from these rather than accumulated, so a run simulated in one
   * pass, in chunks, or resumed from a save lands on identical coordinates.
   * `approachFromZ` is the lane it entered by; its z blends from there to its
   * contact slot as it closes.
   */
  approachFrom?: number;
  approachFromZ?: number;
  approachSince?: number;
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
  combatState?: SpellCombatState;
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
