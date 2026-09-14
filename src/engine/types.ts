import type { CombatPosition } from './combat/SpellCombatState';
// prettier-ignore
import type { CompanionAbility, CompanionClass, CompanionModelKey, CompanionRarity, FormationRow } from './companions/types';
import type { GearSlot } from './gear/types';
import type { QuantitySnapshot } from './numbers';
import type { RunMode } from './model';

export interface GearSnapshot {
  slot: GearSlot;
  /** The slot's own name. Two pieces can share a name; slots cannot. */
  slotLabel: string;
  name: string;
  level: number;
  evolutionTier: number;
  description: string;
  primaryStatLabel: string;
  contribution: QuantitySnapshot;
  /**
   * What the *next* level adds, not what every level adds. A level used to be
   * worth a flat `statPerLevel` and the interface said so; levels compound now,
   * so a standing figure would be true only of the step from 1 to 2. A quantity
   * rather than a number because by level 100 it no longer fits in one.
   */
  nextLevelGain: QuantitySnapshot;
  nextLevelCost: QuantitySnapshot;
  nextEvolutionLevel: number | null;
  unlockedTreeTier: number;
  treeNodes: string[];
}

export interface EnemySnapshot {
  position?: import('./combat/SpellCombatState').CombatPosition;
  statuses?: import('./combat/SpellCombatState').EnemyStatuses;
  instanceId: number;
  modelKey: string;
  name: string;
  boss: boolean;
  hp: QuantitySnapshot;
  maxHp: QuantitySnapshot;
  hpPercent: number;
  /** Still closing the distance, so the renderer can walk it in. */
  approaching: boolean;
}

/**
 * One companion, whether or not it is equipped. Identity and derived power for
 * the interface; position, health and knockout for the renderer - the same
 * shape `EnemySnapshot` uses, so the scene reads both the same way.
 */
export interface CompanionSnapshot {
  definitionId: string;
  name: string;
  description: string;
  rarity: CompanionRarity;
  companionClass: CompanionClass;
  row: FormationRow;
  kind: 'humanoid' | 'creature';
  modelKey: CompanionModelKey;
  stars: number;
  shards: number;
  /** Null once a companion is at five stars and has nothing left to buy. */
  shardsForNextStar: number | null;
  canAscend: boolean;
  ability: CompanionAbility;
  abilityMagnitude: number;
  attackInterval: number;
  threat: number;
  maxHp: QuantitySnapshot;
  damage: QuantitySnapshot;
  /** The party slot it holds, or null when it is only in the roster. */
  slot: number | null;
  /** Live combat state; present only while equipped. */
  hp?: QuantitySnapshot;
  hpPercent?: number;
  downed?: boolean;
  position?: CombatPosition;
}

export interface SummonResultSnapshot {
  definitionId: string;
  name: string;
  rarity: CompanionRarity;
  duplicate: boolean;
  shards: number;
  refund: number;
  stars: number;
}

/**
 * The results of the most recent draw, with the serial that produced them.
 *
 * `runCommand` republishes immediately after every command, so the interface
 * learns what it pulled by seeing a serial it has not animated yet. That keeps
 * the reveal reading authoritative results rather than needing a second
 * channel out of the engine.
 */
export interface LastSummonSnapshot {
  serial: number;
  results: SummonResultSnapshot[];
}

export interface SimulationSnapshot {
  spellMechanics?: import('./spell/SpellMechanics').SpellMechanics;
  combatState?: import('./combat/SpellCombatState').SpellCombatState;
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
  /** The largest legal build the current attunements allow - the real ceiling. */
  spellTreeMaxPoints: number;
  ownedAttunementIds: string[];
  nextSpellPointCost: QuantitySnapshot;
  activeSpellNodeIds: string[];
  progressToNextEncounter: number;
  highestStageEver: number;
  rebirths: number;
  rebirthKnowledgeGain: QuantitySnapshot;
  canRebirth: boolean;
  /** Every point of Knowledge ever earned; what Mastery is read from. */
  lifetimeKnowledge: QuantitySnapshot;
  /** What every Rebirth so far is worth, as a multiplier on the mage. */
  mastery: QuantitySnapshot;
  /** What Mastery would become if the run cashed out now. */
  masteryAfterRebirth: QuantitySnapshot;
  /**
   * The frontier the next point of Knowledge is waiting for, so a disabled
   * Rebirth can say what it is waiting on rather than only greying out.
   */
  nextKnowledgeStage: number;
  gear: GearSnapshot[];
  starlight: QuantitySnapshot;
  summonCost: QuantitySnapshot;
  summonCostTen: QuantitySnapshot;
  canSummon: boolean;
  canSummonTen: boolean;
  /** Draws into the current drought, and the draw that guarantees a Legendary. */
  pityCounter: number;
  pityHard: number;
  /** The whole owned roster, richest first for the ledger. */
  companions: CompanionSnapshot[];
  /** Exactly PARTY_SIZE entries; null is an empty slot. */
  party: (CompanionSnapshot | null)[];
  ascendableCompanions: number;
  /**
   * Permanent narrative beats the player has already been shown. Onboarding is
   * derived from live state wherever it can be - a hint about gold stops being
   * true the moment gold is spent - so this carries only the beats that leave no
   * trace in the state they were about.
   */
  storyFlags: readonly string[];
  lastSummon: LastSummonSnapshot | null;
  lastEvent: string;
}

export type EngineCommand =
  | { type: 'retry_frontier' }
  | { type: 'set_spell_build'; build: import('./spell/types').SpellBuild }
  | { type: 'level_gear'; slot: GearSlot }
  | { type: 'buy_spell_point' }
  | { type: 'buy_attunement'; attunementId: string }
  | { type: 'activate_spell_node'; nodeId: string }
  | { type: 'respec_spell_tree' }
  | { type: 'rebirth' }
  | { type: 'summon_draw'; count: number }
  | { type: 'ascend_companion'; definitionId: string }
  | { type: 'equip_companion'; definitionId: string; slot: number }
  | { type: 'unequip_companion'; slot: number }
  | { type: 'mark_story_flag'; flag: string };
