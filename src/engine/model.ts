import Decimal from 'break_eternity.js';
import type { EquipmentState } from './gear/types';
import type { SpellBuild } from './spell/types';
import type { SpellTreeState } from './spellTree/types';
import type { CombatPosition, EnemyStatuses, SpellCombatState } from './combat/SpellCombatState';
import type { CompanionAura, CompanionCombatant, CompanionsState } from './companions/types';

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
  /**
   * Authored tags, copied at spawn for the same reason. Targeting reads them to
   * decide whether this enemy goes through the front line or around it, and
   * combat must not need the content catalog to answer that.
   */
  tags?: string[];
  /** Which spot around the mage it walked to, so a wave presses in rather than
   * stacking six bodies on one coordinate. */
  contactSlot?: number;
  /** Whether its next swing has already been telegraphed to the renderer. */
  telegraphed?: boolean;
  /**
   * Extra distance this enemy keeps because a frontline was standing when it
   * spawned. Captured once, at spawn, and never recomputed: `contactPoint` has
   * to stay a pure function of stored fields or a chunked run and a single pass
   * would derive different stopping places. A wave that spawns after the tank
   * falls carries no offset, so it presses in toward the mage.
   */
  frontlineOffset?: number;
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
  /**
   * The party as it stands in this encounter. Rebuilt from `CompanionsState`
   * whenever the roster changes, so ownership is persistent and hit points are
   * not - exactly the split enemies already use.
   */
  companions: CompanionCombatant[];
  /**
   * Companions that fought this encounter and are no longer fielded.
   *
   * They keep their wounds here rather than being discarded, so taking a
   * downed companion out of the party and putting it back cannot undo a
   * knockout. A separate list rather than a flag on the combatant: every
   * combat path iterates `companions` and none of them has to learn about it.
   */
  benchedCompanions: CompanionCombatant[];
  /** Timed party buffs the companions have raised. */
  companionAura?: CompanionAura;
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
  /**
   * Every point of Knowledge ever earned, never spent down.
   *
   * `knowledge` is a balance and `buyAttunement` subtracts from it, so it cannot
   * describe how far an account has come - a player who spent it looks like one
   * who never earned it. This is the high-water mark, which is what a permanent
   * reward has to be measured against if buying an attunement is not to cost the
   * player power.
   */
  lifetimeKnowledge: Decimal;
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
  companions: CompanionsState;
}
