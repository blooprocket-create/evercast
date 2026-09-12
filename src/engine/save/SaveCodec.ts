import type { EngineConfig } from '../config';
import { GEAR_SLOT_ORDER } from '../gear/GearCatalog';
import { createInitialEquipmentState } from '../gear/GearSystem';
import type { EquipmentState, GearPieceState, GearSlot } from '../gear/types';
import { COMPANION_BY_ID } from '../companions/CompanionCatalog';
import { createInitialCompanionsState } from '../companions/CompanionSystem';
import type { CompanionCombatant, CompanionsState, OwnedCompanion } from '../companions/types';
import type { EnemyState, GameState } from '../model';
import { big } from '../numbers';
import { SPELL_TREE_NODE_BY_ID } from '../spellTree/SpellTreeCatalog';
import {
  buildSpellFromTree,
  canActivateSpellNode,
  createInitialSpellTreeState,
} from '../spellTree/SpellTreeSystem';
import { clearSpellCombat, ensurePositions } from '../combat/SpellCombatState';
import type { SpellTreeState } from '../spellTree/types';
import { createInitialGameState } from '../state';

export const CURRENT_SAVE_VERSION = 7;

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

type SerializedMeta = Omit<GameState['meta'], 'knowledge'> & { knowledge: string };

interface SerializedEquipment {
  gold: string;
  pieces: Record<GearSlot, GearPieceState>;
}

interface SerializedSpellTree {
  purchasedPoints: number;
  activatedNodeIds: string[];
}

interface LegacySaveEnvelopeV6 {
  version: 6;
  savedAt?: string;
  state: {
    run: SerializedRun;
    meta: SerializedMeta;
    equipment: SerializedEquipment;
    spellTree: SerializedSpellTree;
  };
}

export interface SaveEnvelopeV7 {
  version: 7;
  savedAt: string;
  state: {
    run: SerializedRun;
    meta: SerializedMeta;
    equipment: SerializedEquipment;
    spellTree: SerializedSpellTree;
    companions: SerializedCompanions;
  };
}

export class SaveCodec {
  constructor(private readonly config: EngineConfig) {}

  encode(state: GameState, savedAt = new Date()): SaveEnvelopeV7 {
    return {
      version: CURRENT_SAVE_VERSION,
      savedAt: savedAt.toISOString(),
      state: {
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
        },
        equipment: {
          gold: state.equipment.gold.toString(),
          pieces: structuredClone(state.equipment.pieces),
        },
        spellTree: {
          purchasedPoints: state.spellTree.purchasedPoints,
          activatedNodeIds: [...state.spellTree.activatedNodeIds],
        },
        companions: {
          starlight: state.companions.starlight.toString(),
          owned: structuredClone(state.companions.owned),
          party: [...state.companions.party],
          drawSerial: state.companions.drawSerial,
          pityCounter: state.companions.pityCounter,
        },
      },
    };
  }

  decode(raw: unknown): { state: GameState; savedAt: Date } {
    if (!raw || typeof raw !== 'object') {
      return { state: createInitialGameState(this.config), savedAt: new Date() };
    }

    const version = (raw as { version?: unknown }).version;
    if (
      typeof version !== 'number' ||
      !Number.isInteger(version) ||
      version < MINIMUM_SAVE_VERSION ||
      version > CURRENT_SAVE_VERSION
    ) {
      throw new Error(`Unsupported Evercast save version: ${String(version)}`);
    }

    const envelope = raw as SaveEnvelopeV7 | LegacySaveEnvelopeV6;
    const state: GameState = {
      run: deserializeRun(envelope.state.run),
      meta: deserializeMeta(envelope.state.meta),
      equipment: deserializeEquipment(envelope.state.equipment),
      spellTree: deserializeSpellTree(envelope.state.spellTree, version === 5),
      // v5 and v6 predate companions: those saves arrive with the feature
      // simply not started, rather than losing anything they had.
      companions:
        version === 7
          ? deserializeCompanions((envelope as SaveEnvelopeV7).state.companions)
          : createInitialCompanionsState(),
    };
    state.run.spell = buildSpellFromTree(state.spellTree);
    if (version === 5) clearSpellCombat(state.run);
    ensurePositions(state.run, this.config.enemyAttackRange);
    return { savedAt: new Date(envelope.savedAt ?? Date.now()), state };
  }
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

function deserializeCompanion(companion: SerializedCompanion): CompanionCombatant {
  const { hp, maxHp, shield, ...rest } = companion;
  return {
    ...rest,
    hp: big(hp),
    maxHp: big(maxHp),
    shield: shield === undefined || shield === null ? undefined : big(shield),
  };
}

/** Drops anything the catalog no longer knows, rather than trusting the blob. */
function deserializeCompanionList(raw: SerializedCompanion[] | undefined): CompanionCombatant[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((companion) => companion && COMPANION_BY_ID.has(companion.definitionId))
    .map(deserializeCompanion);
}

/**
 * Everything here is replayed into authoritative state, so a hand-edited or
 * truncated blob must degrade rather than corrupt the roster.
 */
function deserializeCompanions(companions: SerializedCompanions | undefined): CompanionsState {
  const initial = createInitialCompanionsState();
  if (!companions || typeof companions !== 'object') return initial;

  const owned: Record<string, OwnedCompanion> = {};
  for (const [id, entry] of Object.entries(companions.owned ?? {})) {
    if (!entry || typeof entry !== 'object') continue;
    // An id the catalog does not know reaches `requireCompanion` later and
    // throws. `importSaveFile` writes the blob and then reloads, so trusting it
    // here leaves the game unable to boot until storage is cleared by hand.
    if (!COMPANION_BY_ID.has(id)) continue;
    owned[id] = {
      definitionId: id,
      stars: Math.max(1, Math.floor(entry.stars ?? 1)),
      shards: Math.max(0, Math.floor(entry.shards ?? 0)),
    };
  }

  const party = initial.party.map((_, slot) => {
    const id = companions.party?.[slot];
    return typeof id === 'string' && owned[id] ? id : null;
  });

  return {
    starlight: big(companions.starlight ?? '0'),
    owned,
    party,
    drawSerial: Math.max(0, Math.floor(companions.drawSerial ?? 0)),
    pityCounter: Math.max(0, Math.floor(companions.pityCounter ?? 0)),
  };
}

function deserializeEnemy(enemy: SerializedEnemy): EnemyState {
  return {
    ...enemy,
    hp: big(enemy.hp),
    maxHp: big(enemy.maxHp),
    attackDamage: big(enemy.attackDamage),
  };
}

function deserializeRun(run: SerializedRun): GameState['run'] {
  return {
    ...run,
    essence: big(run.essence),
    mage: { hp: big(run.mage.hp), maxHp: big(run.mage.maxHp) },
    enemies: Array.isArray(run.enemies) ? run.enemies.map(deserializeEnemy) : [],
    companions: deserializeCompanionList(run.companions),
    benchedCompanions: deserializeCompanionList(run.benchedCompanions),
    encounter: run.encounter ?? null,
    nextEnemyInstanceId: Math.max(1, run.nextEnemyInstanceId ?? 1),
  };
}

function deserializeMeta(meta: SerializedMeta): GameState['meta'] {
  return { ...meta, knowledge: big(meta.knowledge) };
}

function deserializeEquipment(serialized: SerializedEquipment | undefined): EquipmentState {
  const equipment = createInitialEquipmentState();
  if (!serialized) return equipment;
  equipment.gold = big(serialized.gold ?? 0);

  for (const slot of GEAR_SLOT_ORDER) {
    const saved = serialized.pieces?.[slot];
    if (!saved) continue;
    equipment.pieces[slot] = {
      slot,
      level: Number.isFinite(saved.level) ? Math.max(1, Math.floor(saved.level)) : 1,
      treeNodes: Array.isArray(saved.treeNodes)
        ? saved.treeNodes.filter((node): node is string => typeof node === 'string')
        : [],
    };
  }
  return equipment;
}

function deserializeSpellTree(serialized: SerializedSpellTree | undefined, legacy = false): SpellTreeState {
  if (!serialized) return createInitialSpellTreeState();
  const activatedNodeIds = Array.isArray(serialized.activatedNodeIds)
    ? [
        ...new Set(
          serialized.activatedNodeIds.filter(
            (nodeId): nodeId is string => typeof nodeId === 'string' && SPELL_TREE_NODE_BY_ID.has(nodeId),
          ),
        ),
      ]
    : [];
  const savedPurchased = Number.isFinite(serialized.purchasedPoints)
    ? Math.max(0, Math.floor(serialized.purchasedPoints))
    : 0;
  const state: SpellTreeState = { purchasedPoints: savedPurchased, activatedNodeIds: [] };
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
