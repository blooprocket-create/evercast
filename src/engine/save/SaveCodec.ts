import type { EngineConfig } from '../config';
import { GEAR_SLOT_ORDER } from '../gear/GearCatalog';
import { createInitialEquipmentState, equivalentGearLevel, mageMaxHealth } from '../gear/GearSystem';
import type { EquipmentState, GearPieceState, GearSlot } from '../gear/types';
import { COMPANION_BY_ID } from '../companions/CompanionCatalog';
import { createInitialCompanionsState } from '../companions/CompanionSystem';
import {
  MAX_COMPANION_STARS,
  PARTY_SIZE,
  type CompanionAura,
  type CompanionCombatant,
  type CompanionsState,
  type OwnedCompanion,
} from '../companions/types';
import type { CombatPhase, EnemyState, GameState, RunMode, RunStatistics } from '../model';
import { ENEMIES } from '../../content/enemies';
import { ZONES } from '../../content/zones';
import { big } from '../numbers';
import { SPELL_TREE_NODE_BY_ID } from '../spellTree/SpellTreeCatalog';
import { SPELL_ATTUNEMENTS, SPELL_ATTUNEMENT_BY_ID } from '../../content/spellTree';
import { SPELL_MECHANIC_DEFAULTS } from '../../content/spellTreeTuning';
import type { SpellMechanics } from '../spell/SpellMechanics';
import {
  buildSpellFromTree,
  canActivateSpellNode,
  createInitialSpellTreeState,
} from '../spellTree/SpellTreeSystem';
import {
  clearSpellCombat,
  createSpellCombatState,
  ensurePositions,
  type DotState,
  type EnemyStatuses,
  type PendingMeteor,
  type SpellCombatState,
} from '../combat/SpellCombatState';
import type { SpellTreeState } from '../spellTree/types';
import { createInitialGameState, createInitialRunState } from '../state';
import {
  guardedArray,
  guardedBoolean,
  guardedCount,
  guardedDecimal,
  guardedEnum,
  guardedIdList,
  guardedNumber,
  guardedObject,
  guardedString,
  MAX_SAVE_ARRAY,
} from './SaveGuards';
import { saveDigest, verifySaveDigest, type IntegrityVerdict } from './SaveIntegrity';

export const CURRENT_SAVE_VERSION = 9;

/**
 * The oldest save still brought forward.
 *
 * v1-v4 migrations were dropped once the format settled: they carried a second
 * enemy shape, a pre-encounter run shape and a reconciliation pass for the
 * repeatable-Essence economy that no longer exists. v5 and v6 stay because they
 * are read by the current path and cost two conditionals, not a code path.
 * Anything older is refused, `BrowserSaveStore.load` reports it, and the player
 * starts fresh rather than loading a state this codec can no longer describe.
 */
export const MINIMUM_SAVE_VERSION = 5;

/**
 * Ceilings for the fields a save can inflate.
 *
 * These are not balance numbers and nothing in the game reads them as tuning.
 * They exist so that a blob claiming four million live enemies or a gear level
 * of 1e308 degrades into something the simulation can still draw a frame of.
 * Each one is far above anything play reaches and far below anything that
 * hangs a tab.
 */
const LIMITS = {
  enemies: 64,
  gearLevel: 1_000_000,
  storyFlags: 256,
  unlockedSystems: 64,
  meteors: 64,
  /** Seconds. Roughly three years of a single continuous run. */
  elapsedSeconds: 1e8,
  /** Stages, kills and rebirths are counters; this is well past any real one. */
  counter: Number.MAX_SAFE_INTEGER,
} as const;

const ENEMY_IDS = new Set(ENEMIES.map((enemy) => enemy.id));
const ZONE_NAMES = ZONES.map((zone) => zone.name);
const RUN_MODES: readonly RunMode[] = ['push', 'farm'];
const COMBAT_PHASES: readonly CombatPhase[] = ['travel', 'combat'];

type SerializedEnemy = Omit<EnemyState, 'hp' | 'maxHp' | 'attackDamage'> & {
  hp: string;
  maxHp: string;
  attackDamage: string;
};

/**
 * Every Decimal is named explicitly. Omitting one leaves it typed as a Decimal
 * while JSON flattens it to a plain value, and nothing on the type side catches
 * it - the blob is read back through an `as` cast. The next `.cmp()` then
 * throws in the middle of combat.
 */
type SerializedCompanion = Omit<CompanionCombatant, 'hp' | 'maxHp' | 'shield'> & {
  hp: string;
  maxHp: string;
  shield?: string;
};

type SerializedRun = Omit<
  GameState['run'],
  'essence' | 'mage' | 'enemies' | 'companions' | 'benchedCompanions'
> & {
  essence: string;
  mage: { hp: string; maxHp: string };
  enemies: SerializedEnemy[];
  /** Absent in v6 and earlier, which predate companions entirely. */
  companions?: SerializedCompanion[];
  benchedCompanions?: SerializedCompanion[];
};

interface SerializedCompanions {
  starlight: string;
  owned: Record<string, OwnedCompanion>;
  party: (string | null)[];
  drawSerial: number;
  pityCounter: number;
}

type SerializedMeta = Omit<GameState['meta'], 'knowledge' | 'lifetimeKnowledge'> & {
  knowledge: string;
  /** Added in v9. Older saves reconstruct it; see `deserializeMeta`. */
  lifetimeKnowledge?: string;
};

interface SerializedEquipment {
  gold: string;
  pieces: Record<GearSlot, GearPieceState>;
}

interface SerializedSpellTree {
  purchasedPoints: number;
  activatedNodeIds: string[];
  /** Added in v8. Older saves decode to none, which is the pre-expansion rule set. */
  attunements?: string[];
}

interface SerializedState {
  run: SerializedRun;
  meta: SerializedMeta;
  equipment: SerializedEquipment;
  spellTree: SerializedSpellTree;
  companions: SerializedCompanions;
}

export interface SaveEnvelope {
  version: 9;
  savedAt: string;
  /**
   * A digest of `state` and `savedAt`. Tamper-evident, not tamper-proof, and
   * `SaveIntegrity.ts` is explicit about the difference: it catches a save that
   * changed underneath the game, not a player who means to cheat their own.
   * Optional on the way in so a save written before digests existed still loads.
   */
  integrity?: string;
  state: SerializedState;
}

export interface DecodedSave {
  state: GameState;
  savedAt: Date;
  /** What the digest said. `missing` is an older save, not an accusation. */
  integrity: IntegrityVerdict;
}

export class SaveCodec {
  constructor(private readonly config: EngineConfig) {}

  encode(state: GameState, savedAt = new Date()): SaveEnvelope {
    const stamp = Number.isFinite(savedAt.getTime()) ? savedAt : new Date();
    const serialized: SerializedState = {
      run: {
        ...state.run,
        stats: { ...state.run.stats },
        spell: structuredClone(state.run.spell),
        encounter: state.run.encounter ? structuredClone(state.run.encounter) : null,
        combatState: state.run.combatState ? structuredClone(state.run.combatState) : undefined,
        essence: state.run.essence.toString(),
        mage: {
          hp: state.run.mage.hp.toString(),
          maxHp: state.run.mage.maxHp.toString(),
        },
        enemies: state.run.enemies.map(serializeEnemy),
        companions: state.run.companions.map(serializeCompanion),
        benchedCompanions: state.run.benchedCompanions.map(serializeCompanion),
      },
      meta: {
        ...state.meta,
        storyFlags: [...state.meta.storyFlags],
        unlockedSystems: [...state.meta.unlockedSystems],
        knowledge: state.meta.knowledge.toString(),
        lifetimeKnowledge: state.meta.lifetimeKnowledge.toString(),
      },
      equipment: {
        gold: state.equipment.gold.toString(),
        pieces: structuredClone(state.equipment.pieces),
      },
      spellTree: {
        purchasedPoints: state.spellTree.purchasedPoints,
        activatedNodeIds: [...state.spellTree.activatedNodeIds],
        attunements: [...state.spellTree.attunements],
      },
      companions: {
        starlight: state.companions.starlight.toString(),
        owned: structuredClone(state.companions.owned),
        party: [...state.companions.party],
        drawSerial: state.companions.drawSerial,
        pityCounter: state.companions.pityCounter,
      },
    };
    const savedAtIso = stamp.toISOString();
    return {
      version: CURRENT_SAVE_VERSION,
      savedAt: savedAtIso,
      integrity: saveDigest({ savedAt: savedAtIso, state: serialized }),
      state: serialized,
    };
  }

  /**
   * Rebuilds `GameState` from an untrusted blob.
   *
   * Nothing here spreads the input. Every field is read by name, checked, and
   * clamped to something the rules can express, so the worst an edited or
   * corrupted save can do is lose its own detail - never hand the simulation a
   * value it has no way to recover from, and never crash the boot it happens on.
   *
   * A failed digest does not throw. Refusing to load here would mean a player
   * whose storage was truncated by a full disk loses their run and can do
   * nothing about it, and it would buy no security at all: anyone able to edit
   * the blob is equally able to recompute the digest over it. The verdict is
   * returned instead, and the one caller that can act on it usefully -
   * `BrowserSaveStore.importSave`, where there is a file to reject and a player
   * to tell - does.
   */
  decode(raw: unknown): DecodedSave {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { state: createInitialGameState(this.config), savedAt: new Date(), integrity: 'missing' };
    }

    const envelope = raw as Record<string, unknown>;
    const version = envelope.version;
    if (
      typeof version !== 'number' ||
      !Number.isInteger(version) ||
      version < MINIMUM_SAVE_VERSION ||
      version > CURRENT_SAVE_VERSION
    ) {
      throw new Error(`Unsupported Evercast save version: ${String(version)}`);
    }

    const savedAtRaw = envelope.savedAt;
    const integrity = verifySaveDigest(
      { savedAt: savedAtRaw, state: envelope.state },
      envelope.integrity,
    );

    const serialized = guardedObject(envelope.state);
    const spellTree = deserializeSpellTree(serialized.spellTree, version === 5);
    const state: GameState = {
      run: deserializeRun(serialized.run, this.config),
      meta: deserializeMeta(serialized.meta, spellTree.attunements),
      equipment: deserializeEquipment(serialized.equipment, version),
      spellTree,
      // v5 and v6 predate companions: those saves arrive with the feature
      // simply not started, rather than losing anything they had.
      companions:
        version >= 7 ? deserializeCompanions(serialized.companions) : createInitialCompanionsState(),
    };

    // The party can only hold companions the roster actually owns, and the
    // fielded combatants can only be companions the party actually deployed -
    // neither of which the two blobs are checked against each other for above.
    reconcileCompanions(state);
    // Allocations decide the spell; the blob's copy of it is never read.
    state.run.spell = buildSpellFromTree(state.spellTree);
    // Gear decides the mage's maximum, for the same reason: the blob's copy is a
    // cache of a derived value, and a v9 conversion has just moved what it was
    // derived from. Re-deriving it costs nothing on a save that already agreed,
    // and stops a migrated one from loading two health bars out of step with its
    // own equipment until the next purchase happened to resync them.
    state.run.mage.maxHp = mageMaxHealth(state, this.config.baseMageHealth);
    state.run.mage.hp = state.run.mage.hp.min(state.run.mage.maxHp);
    // A run cannot have got further than the account's own record of it.
    state.meta.highestStageEver = Math.max(
      state.meta.highestStageEver,
      state.run.frontierStage,
      state.run.highestStageThisRun,
    );
    if (version === 5) clearSpellCombat(state.run);
    ensurePositions(state.run, this.config.enemyAttackRange);
    return { savedAt: guardedDate(savedAtRaw), state, integrity };
  }
}

/** An ISO stamp the rest of the app can do arithmetic with, or now. */
function guardedDate(value: unknown): Date {
  if (typeof value !== 'string' && typeof value !== 'number') return new Date();
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : new Date();
}

function serializeEnemy(enemy: EnemyState): SerializedEnemy {
  // `telegraphed` says the renderer has been told about a swing, which cannot
  // be true of a session that has not started yet.
  const { telegraphed: _presentationOnly, ...rest } = enemy;
  return {
    ...rest,
    statuses: enemy.statuses ? structuredClone(enemy.statuses) : undefined,
    position: enemy.position ? { ...enemy.position } : undefined,
    hp: enemy.hp.toString(),
    maxHp: enemy.maxHp.toString(),
    attackDamage: enemy.attackDamage.toString(),
  };
}

function serializeCompanion(companion: CompanionCombatant): SerializedCompanion {
  const { hp, maxHp, shield, ...rest } = companion;
  return {
    ...rest,
    hp: hp.toString(),
    maxHp: maxHp.toString(),
    shield: shield ? shield.toString() : undefined,
  };
}

/**
 * A `SpellMechanics` read back from a blob.
 *
 * The key set and every value's type come from `SPELL_MECHANIC_DEFAULTS`
 * rather than from a list written out here, which is what keeps this correct
 * when a mutation is added to the tree: a key the defaults do not declare is
 * dropped, and a value of the wrong type falls back to the authored default.
 */
function guardedMechanics(raw: unknown): SpellMechanics {
  const source = guardedObject(raw);
  const mechanics = { ...SPELL_MECHANIC_DEFAULTS } as Record<string, unknown>;
  for (const [key, fallback] of Object.entries(SPELL_MECHANIC_DEFAULTS)) {
    const value = source[key];
    if (typeof fallback === 'boolean') mechanics[key] = guardedBoolean(value, fallback);
    else if (typeof fallback === 'number') mechanics[key] = guardedNumber(value, fallback);
    else mechanics[key] = guardedEnum(value, ['base', 'twin', 'piercing', 'charged'], 'base');
  }
  return mechanics as unknown as SpellMechanics;
}

function guardedPosition(raw: unknown): { x: number; z: number } | undefined {
  if (raw === undefined || raw === null) return undefined;
  const source = guardedObject(raw);
  return { x: guardedNumber(source.x, 0), z: guardedNumber(source.z, 0) };
}

function guardedDot(raw: unknown): DotState | undefined {
  if (raw === undefined || raw === null) return undefined;
  const source = guardedObject(raw);
  return {
    baseDamage: guardedDecimal(source.baseDamage, 0).toString(),
    damage: guardedDecimal(source.damage, 0).toString(),
    nextTickAt: guardedNumber(source.nextTickAt, 0, { min: 0 }),
    expiresAt: guardedNumber(source.expiresAt, 0, { min: 0 }),
    castId: guardedCount(source.castId),
    sourceInstanceId: guardedCount(source.sourceInstanceId),
    mechanics: guardedMechanics(source.mechanics),
  };
}

function guardedStatuses(raw: unknown): EnemyStatuses | undefined {
  if (raw === undefined || raw === null) return undefined;
  const source = guardedObject(raw);
  const statuses: EnemyStatuses = {};
  const dot = guardedDot(source.dot);
  if (dot) statuses.dot = dot;
  if (source.weakness !== undefined && source.weakness !== null) {
    const weakness = guardedObject(source.weakness);
    statuses.weakness = {
      stacks: guardedCount(weakness.stacks, 0, 1000),
      strength: guardedNumber(weakness.strength, 0),
      expiresAt: guardedNumber(weakness.expiresAt, 0, { min: 0 }),
    };
  }
  if (source.ruin !== undefined && source.ruin !== null) {
    const ruin = guardedObject(source.ruin);
    statuses.ruin = {
      amplification: guardedNumber(ruin.amplification, 1),
      expiresAt: guardedNumber(ruin.expiresAt, 0, { min: 0 }),
    };
  }
  return statuses;
}

/**
 * An enemy whose definition the content catalog no longer knows is dropped
 * outright rather than clamped. `requireEnemy` throws on an unknown id while
 * the snapshot is being built, which happens on the way to the first frame -
 * so a single edited `definitionId` used to be a blank page on every reload.
 */
function deserializeEnemy(raw: unknown): EnemyState | null {
  const source = guardedObject(raw);
  const definitionId = guardedString(source.definitionId, '');
  if (!ENEMY_IDS.has(definitionId)) return null;

  const maxHp = guardedDecimal(source.maxHp, 1);
  const enemy: EnemyState = {
    instanceId: guardedCount(source.instanceId, 1),
    definitionId,
    name: guardedString(source.name, definitionId),
    stage: guardedCount(source.stage, 1, LIMITS.counter),
    boss: guardedBoolean(source.boss, false),
    // Health above the maximum is the one clamp here that is a rule rather than
    // a bound: an enemy at 300% health is not a state the spawner can produce.
    hp: bounded(guardedDecimal(source.hp, maxHp), maxHp),
    maxHp,
    attackDamage: guardedDecimal(source.attackDamage, 0),
    attackInterval: guardedNumber(source.attackInterval, 1, { min: 0.05, max: 3600 }),
    attackCooldown: guardedNumber(source.attackCooldown, 0, { min: 0, max: 3600 }),
  };

  const position = guardedPosition(source.position);
  if (position) enemy.position = position;
  const statuses = guardedStatuses(source.statuses);
  if (statuses) enemy.statuses = statuses;
  if (source.attackRange !== undefined)
    enemy.attackRange = guardedNumber(source.attackRange, 1, { min: 0, max: 1000 });
  if (source.tags !== undefined)
    enemy.tags = guardedArray(source.tags, (tag) => guardedString(tag, '') || null, 32);
  if (source.contactSlot !== undefined) enemy.contactSlot = guardedCount(source.contactSlot, 0, 64);
  if (source.frontlineOffset !== undefined)
    enemy.frontlineOffset = guardedNumber(source.frontlineOffset, 0, { min: -100, max: 100 });
  if (source.approachFrom !== undefined)
    enemy.approachFrom = guardedNumber(source.approachFrom, 0, { min: -1000, max: 1000 });
  if (source.approachFromZ !== undefined)
    enemy.approachFromZ = guardedNumber(source.approachFromZ, 0, { min: -1000, max: 1000 });
  if (source.approachSince !== undefined)
    enemy.approachSince = guardedNumber(source.approachSince, 0, { min: 0 });
  return enemy;
}

/** `value`, or `ceiling` if it is larger. Both are already known finite. */
function bounded(value: ReturnType<typeof guardedDecimal>, ceiling: ReturnType<typeof guardedDecimal>) {
  return value.cmp(ceiling) > 0 ? ceiling : value;
}

function deserializeCompanion(raw: unknown): CompanionCombatant | null {
  const source = guardedObject(raw);
  const definitionId = guardedString(source.definitionId, '');
  if (!COMPANION_BY_ID.has(definitionId)) return null;

  const maxHp = guardedDecimal(source.maxHp, 1);
  const companion: CompanionCombatant = {
    slot: guardedCount(source.slot, 0, PARTY_SIZE - 1),
    definitionId,
    stars: guardedNumber(source.stars, 1, { min: 1, max: MAX_COMPANION_STARS, integer: true }),
    hp: bounded(guardedDecimal(source.hp, maxHp), maxHp),
    maxHp,
    attackCooldown: guardedNumber(source.attackCooldown, 0, { min: 0, max: 3600 }),
    abilityCooldown: guardedNumber(source.abilityCooldown, 0, { min: 0, max: 3600 }),
    downed: guardedBoolean(source.downed, false),
  };
  if (source.shield !== undefined && source.shield !== null)
    companion.shield = guardedDecimal(source.shield, 0);
  if (source.revivedThisEncounter !== undefined)
    companion.revivedThisEncounter = guardedBoolean(source.revivedThisEncounter, false);
  return companion;
}

function deserializeCompanionList(raw: unknown): CompanionCombatant[] {
  return guardedArray(raw, deserializeCompanion, PARTY_SIZE * 4);
}

/**
 * Everything here is replayed into authoritative state, so a hand-edited or
 * truncated blob must degrade rather than corrupt the roster.
 */
function deserializeCompanions(raw: unknown): CompanionsState {
  const initial = createInitialCompanionsState();
  const companions = guardedObject(raw);

  const owned: Record<string, OwnedCompanion> = {};
  const ownedSource = guardedObject(companions.owned);
  for (const [id, entry] of Object.entries(ownedSource)) {
    // An id the catalog does not know reaches `requireCompanion` later and
    // throws. `importSaveFile` writes the blob and then reloads, so trusting it
    // here leaves the game unable to boot until storage is cleared by hand.
    if (!COMPANION_BY_ID.has(id)) continue;
    if (Object.keys(owned).length >= COMPANION_BY_ID.size) break;
    const companion = guardedObject(entry);
    owned[id] = {
      definitionId: id,
      stars: guardedNumber(companion.stars, 1, { min: 1, max: MAX_COMPANION_STARS, integer: true }),
      shards: guardedCount(companion.shards, 0, LIMITS.counter),
    };
  }

  const party = initial.party.map((_, slot) => {
    const id = Array.isArray(companions.party) ? companions.party[slot] : null;
    return typeof id === 'string' && owned[id] ? id : null;
  });

  return {
    starlight: guardedDecimal(companions.starlight, 0),
    owned,
    party,
    drawSerial: guardedCount(companions.drawSerial, 0, LIMITS.counter),
    pityCounter: guardedCount(companions.pityCounter, 0, LIMITS.counter),
  };
}

/**
 * Makes the two halves of the companion feature agree with each other.
 *
 * Ownership and the party live in `CompanionsState`; the combatants that are
 * actually swinging live in `RunState`. Each is validated against the catalog
 * on the way in, but nothing above checks them against *each other*, and a save
 * claiming a fielded 5-star companion the roster has never heard of would field
 * it.
 *
 * The two lists answer to different rules, which is the whole reason this is
 * not one filter. A fielded companion has to hold a party slot. A benched one
 * has to *not* hold one - that is what benched means: it fought, it was taken
 * out of the party, and it keeps its wounds there so that putting it back
 * cannot undo a knockout. Both have to be owned, and both take their star
 * rating from the roster rather than from their own copy of it.
 */
function reconcileCompanions(state: GameState): void {
  const { owned, party } = state.companions;
  const deployed = new Set(party.filter((id): id is string => id !== null));
  const restar = (companion: CompanionCombatant): CompanionCombatant => ({
    ...companion,
    stars: owned[companion.definitionId]?.stars ?? companion.stars,
  });
  state.run.companions = state.run.companions
    .filter((companion) => deployed.has(companion.definitionId))
    .map(restar);
  state.run.benchedCompanions = state.run.benchedCompanions
    .filter(
      (companion) =>
        owned[companion.definitionId] !== undefined && !deployed.has(companion.definitionId),
    )
    .map(restar);
}

function guardedAura(raw: unknown): CompanionAura | undefined {
  if (raw === undefined || raw === null) return undefined;
  const source = guardedObject(raw);
  return {
    rallyAmount: guardedNumber(source.rallyAmount, 0),
    rallyUntil: guardedNumber(source.rallyUntil, 0, { min: 0 }),
  };
}

function guardedMeteor(raw: unknown): PendingMeteor | null {
  const source = guardedObject(raw);
  return {
    id: guardedCount(source.id, 0),
    dueAt: guardedNumber(source.dueAt, 0, { min: 0 }),
    position: guardedPosition(source.position) ?? { x: 0, z: 0 },
    targetId: guardedCount(source.targetId, 0),
    castId: guardedCount(source.castId, 0),
    damage: guardedDecimal(source.damage, 0).toString(),
    mechanics: guardedMechanics(source.mechanics),
    infect: guardedBoolean(source.infect, false),
  };
}

function guardedCombatState(raw: unknown): SpellCombatState | undefined {
  if (raw === undefined || raw === null) return undefined;
  const source = guardedObject(raw);
  const fallback = createSpellCombatState();
  const targetId = source.superchargeTargetId;
  return {
    procSerial: guardedCount(source.procSerial, fallback.procSerial),
    meteors: guardedArray(source.meteors, guardedMeteor, LIMITS.meteors),
    momentum: guardedNumber(source.momentum, fallback.momentum, { min: 0 }),
    momentumUntil: guardedNumber(source.momentumUntil, fallback.momentumUntil, { min: 0 }),
    overdriveUntil: guardedNumber(source.overdriveUntil, fallback.overdriveUntil, { min: 0 }),
    focus: guardedNumber(source.focus, fallback.focus, { min: 0 }),
    supercharge: guardedNumber(source.supercharge, fallback.supercharge, { min: 0 }),
    superchargeTargetId: typeof targetId === 'number' ? guardedCount(targetId, 0) : null,
    velocityStored: guardedDecimal(source.velocityStored, 0).toString(),
    velocityReady: guardedBoolean(source.velocityReady, fallback.velocityReady),
    nextCastHaste: guardedBoolean(source.nextCastHaste, fallback.nextCastHaste),
  };
}

function guardedEncounter(raw: unknown): GameState['run']['encounter'] {
  if (raw === undefined || raw === null) return null;
  const source = guardedObject(raw);
  return {
    stage: guardedCount(source.stage, 1, LIMITS.counter),
    totalEnemies: guardedCount(source.totalEnemies, 0, LIMITS.enemies * 8),
    spawnedEnemies: guardedCount(source.spawnedEnemies, 0, LIMITS.enemies * 8),
    spawnInterval: guardedNumber(source.spawnInterval, 1, { min: 0.05, max: 3600 }),
    spawnCooldown: guardedNumber(source.spawnCooldown, 0, { min: 0, max: 3600 }),
    maxAlive: guardedCount(source.maxAlive, 1, LIMITS.enemies),
    bossStage: guardedBoolean(source.bossStage, false),
  };
}

function guardedStats(raw: unknown): RunStatistics {
  const source = guardedObject(raw);
  return {
    casts: guardedCount(source.casts, 0, LIMITS.counter),
    projectileHits: guardedCount(source.projectileHits, 0, LIMITS.counter),
    criticalHits: guardedCount(source.criticalHits, 0, LIMITS.counter),
    kills: guardedCount(source.kills, 0, LIMITS.counter),
    deaths: guardedCount(source.deaths, 0, LIMITS.counter),
    bossKills: guardedCount(source.bossKills, 0, LIMITS.counter),
  };
}

function deserializeRun(raw: unknown, config: EngineConfig): GameState['run'] {
  const source = guardedObject(raw);
  const initial = createInitialRunState(config);
  const frontierStage = guardedCount(source.frontierStage, 1, LIMITS.counter) || 1;
  const maxHp = guardedDecimal((source.mage as { maxHp?: unknown } | undefined)?.maxHp, config.baseMageHealth);
  const mage = guardedObject(source.mage);

  const run: GameState['run'] = {
    ...initial,
    elapsedSeconds: guardedNumber(source.elapsedSeconds, 0, { min: 0, max: LIMITS.elapsedSeconds }),
    frontierStage,
    highestStageThisRun: Math.max(
      frontierStage,
      guardedCount(source.highestStageThisRun, 1, LIMITS.counter),
    ),
    encounterStage: guardedCount(source.encounterStage, 1, LIMITS.counter) || 1,
    zoneNumber: guardedCount(source.zoneNumber, 1, LIMITS.counter) || 1,
    zoneName: guardedEnum(source.zoneName, ZONE_NAMES, initial.zoneName),
    mode: guardedEnum(source.mode, RUN_MODES, initial.mode),
    farmStage: guardedCount(source.farmStage, 1, LIMITS.counter) || 1,
    farmKillsSinceFailure: guardedCount(source.farmKillsSinceFailure, 0, LIMITS.counter),
    phase: guardedEnum(source.phase, COMBAT_PHASES, initial.phase),
    travelElapsed: guardedNumber(source.travelElapsed, 0, { min: 0, max: LIMITS.elapsedSeconds }),
    castCooldown: guardedNumber(source.castCooldown, 0, { min: 0, max: 3600 }),
    essence: guardedDecimal(source.essence, 0),
    mage: { hp: bounded(guardedDecimal(mage.hp, maxHp), maxHp), maxHp },
    enemies: guardedArray(source.enemies, deserializeEnemy, LIMITS.enemies),
    companions: deserializeCompanionList(source.companions),
    benchedCompanions: deserializeCompanionList(source.benchedCompanions),
    encounter: guardedEncounter(source.encounter),
    nextEnemyInstanceId: guardedCount(source.nextEnemyInstanceId, 1, LIMITS.counter) || 1,
    stats: guardedStats(source.stats),
  };

  const combatState = guardedCombatState(source.combatState);
  if (combatState) run.combatState = combatState;
  const aura = guardedAura(source.companionAura);
  if (aura) run.companionAura = aura;
  // An instance id already in play would let two enemies share an identity,
  // which targeting and the renderer both resolve by id.
  for (const enemy of run.enemies)
    run.nextEnemyInstanceId = Math.max(run.nextEnemyInstanceId, enemy.instanceId + 1);
  return run;
}

/**
 * `attunements` is the *granted* list `deserializeSpellTree` has already filtered
 * down to what the prerequisites allow, not the raw blob - an attunement the save
 * claims but cannot hold was never paid for and must not be counted as spent.
 */
function deserializeMeta(raw: unknown, attunements: readonly string[]): GameState['meta'] {
  const source = guardedObject(raw);
  const knowledge = guardedDecimal(source.knowledge, 0);
  return {
    rebirths: guardedCount(source.rebirths, 0, LIMITS.counter),
    knowledge,
    /**
     * Reconstructed rather than defaulted on a save written before v9, and the
     * reconstruction is exact: attunements are the only thing that has ever
     * subtracted Knowledge, so everything ever earned is what is banked plus
     * what was spent.
     *
     * Keyed on the field being absent rather than on the version, because the
     * codec is routinely handed a current save relabelled as an older one - and
     * reconstructing on top of a value that is already correct would add the
     * spend a second time on every load.
     *
     * Clamped to the balance because the high-water mark cannot be below it.
     */
    lifetimeKnowledge:
      source.lifetimeKnowledge === undefined
        ? attunements.reduce(
            (total, id) => total.add(SPELL_ATTUNEMENT_BY_ID.get(id)?.cost ?? 0),
            knowledge,
          )
        : guardedDecimal(source.lifetimeKnowledge, 0).max(knowledge),
    highestStageEver: guardedCount(source.highestStageEver, 1, LIMITS.counter) || 1,
    lifetimeKills: guardedCount(source.lifetimeKills, 0, LIMITS.counter),
    // Flags and unlocks are authored elsewhere and only ever compared for
    // membership, so an unknown one is inert - but an unbounded list of them is
    // still a blob that has to be held in memory and written back on every save.
    storyFlags: guardedIdList(source.storyFlags, () => true, LIMITS.storyFlags),
    unlockedSystems: guardedIdList(source.unlockedSystems, () => true, LIMITS.unlockedSystems),
  };
}

function deserializeEquipment(raw: unknown, version: number): EquipmentState {
  const equipment = createInitialEquipmentState();
  if (raw === undefined || raw === null) return equipment;
  const serialized = guardedObject(raw);
  equipment.gold = guardedDecimal(serialized.gold, 0);

  const pieces = guardedObject(serialized.pieces);
  for (const slot of GEAR_SLOT_ORDER) {
    const saved = guardedObject(pieces[slot]);
    if (Object.keys(saved).length === 0) continue;
    // Guarded first, so the conversion below works on a finite integer already
    // inside the level bounds rather than on whatever the file happened to hold.
    const level = guardedNumber(saved.level, 1, { min: 1, max: LIMITS.gearLevel, integer: true });
    equipment.pieces[slot] = {
      slot,
      // v9 made a gear level multiply rather than add. Reading an old level
      // through the new curve would not rebalance it, it would detonate it: a
      // level-201 staff was worth 200 damage, and the same level under the new
      // curve is worth ten million. Converting to the level that preserves the
      // power the player actually had means they keep their damage and see a
      // smaller number printed beside it - which is worth saying out loud in
      // the patch notes, because 201 becoming 41 reads as a loss until you
      // check the damage.
      level: version < 9 ? equivalentGearLevel(level) : level,
      treeNodes: guardedIdList(saved.treeNodes, () => true, MAX_SAVE_ARRAY),
    };
  }
  return equipment;
}

function deserializeSpellTree(raw: unknown, legacy = false): SpellTreeState {
  if (raw === undefined || raw === null) return createInitialSpellTreeState();
  const serialized = guardedObject(raw);
  const activatedNodeIds = guardedIdList(
    serialized.activatedNodeIds,
    (id) => SPELL_TREE_NODE_BY_ID.has(id),
    SPELL_TREE_NODE_BY_ID.size,
  );
  // Attunements are read before allocations on purpose: they decide the group
  // caps the allocation rebuild below is validated against. An attunement whose
  // own prerequisite is missing is dropped, so a hand-edited save cannot widen
  // the tree by naming `third_route` alone.
  const attunements = guardedIdList(
    serialized.attunements,
    (id) => SPELL_ATTUNEMENT_BY_ID.has(id),
    SPELL_ATTUNEMENTS.length,
  );
  const granted: string[] = [];
  for (const attunement of SPELL_ATTUNEMENTS)
    if (
      attunements.includes(attunement.id) &&
      attunement.requires.every((required) => granted.includes(required))
    )
      granted.push(attunement.id);

  // Bounded and whole, but deliberately not capped at what the current unlocks
  // could absorb. Points are bought with Essence and the tree's rules decide
  // what may be spent on, so an inflated count buys nothing: every allocation
  // below still has to pass `canActivateSpellNode`. Capping it would instead
  // take points from the player whenever a rule tightened, which is the case
  // `drops allocations ... without minting points` exists to hold onto.
  const state: SpellTreeState = {
    purchasedPoints: guardedCount(serialized.purchasedPoints, 0, LIMITS.counter),
    activatedNodeIds: [],
    attunements: granted,
  };
  if (legacy) return state;
  // Rebuild in dependency order, enforcing point budgets and every exclusivity group.
  let pending = activatedNodeIds;
  while (pending.length) {
    const before = pending.length;
    pending = pending.filter((id) => {
      if (!canActivateSpellNode(state, id)) return true;
      state.activatedNodeIds.push(id);
      return false;
    });
    if (before === pending.length) break;
  }
  return state;
}
