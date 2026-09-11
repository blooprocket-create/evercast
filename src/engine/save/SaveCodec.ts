import type { EngineConfig } from '../config';
import { GEAR_SLOT_ORDER } from '../gear/GearCatalog';
import { createInitialEquipmentState } from '../gear/GearSystem';
import type { EquipmentState, GearPieceState, GearSlot } from '../gear/types';
import { createInitialCompanionsState } from '../companions/CompanionSystem';
import type { CompanionCombatant, CompanionsState, OwnedCompanion } from '../companions/types';
import { PARTY_SIZE } from '../companions/types';
import type { EnemyState, GameState } from '../model';
import { big } from '../numbers';
import { totalFirstClearEssenceEarned } from '../progression/EssenceEconomy';
import {
  SPELL_TREE_NODE_BY_ID,
  SPELL_TREE_STARTER_POINTS,
  spellPointCost,
} from '../spellTree/SpellTreeCatalog';
import {
  buildSpellFromTree,
  canActivateSpellNode,
  createInitialSpellTreeState,
} from '../spellTree/SpellTreeSystem';
import { clearSpellCombat, ensurePositions } from '../combat/SpellCombatState';
import type { SpellTreeState } from '../spellTree/types';
import { createInitialGameState } from '../state';

export const CURRENT_SAVE_VERSION = 7;

type SerializedEnemy = Omit<EnemyState, 'hp' | 'maxHp' | 'attackDamage'> & {
  hp: string;
  maxHp: string;
  attackDamage: string;
  // v3-v5 saves may contain the old repeatable-Essence reward field. It is ignored on load.
  reward?: string;
};

type SerializedCompanion = Omit<CompanionCombatant, 'hp' | 'maxHp'> & {
  hp: string;
  maxHp: string;
};

type SerializedRunV3 = Omit<GameState['run'], 'essence' | 'mage' | 'enemies' | 'companions'> & {
  essence: string;
  mage: { hp: string; maxHp: string };
  enemies: SerializedEnemy[];
  /** Absent in v6 and earlier, which predate companions entirely. */
  companions?: SerializedCompanion[];
};

interface SerializedCompanions {
  starlight: string;
  owned: Record<string, OwnedCompanion>;
  party: (string | null)[];
  drawSerial: number;
  pityCounter: number;
}

type LegacyEnemy = Omit<EnemyState, 'instanceId' | 'hp' | 'maxHp' | 'attackDamage'> & {
  hp: string;
  maxHp: string;
  attackDamage: string;
  reward?: string;
};

type LegacySerializedRun = Omit<
  GameState['run'],
  'essence' | 'mage' | 'enemies' | 'encounter' | 'nextEnemyInstanceId' | 'companions'
> & {
  essence: string;
  mage: { hp: string; maxHp: string };
  enemy?: LegacyEnemy | null;
};

type SerializedMeta = Omit<GameState['meta'], 'knowledge'> & { knowledge: string };

interface SerializedEquipment {
  gold: string;
  pieces: Record<GearSlot, GearPieceState>;
}

interface SerializedSpellTree {
  purchasedPoints: number;
  activatedNodeIds: string[];
}

interface LegacySaveEnvelopeV3 {
  version: 3;
  savedAt?: string;
  state: {
    run: SerializedRunV3;
    meta: SerializedMeta;
    equipment: SerializedEquipment;
  };
}

interface LegacySaveEnvelopeV4 {
  version: 4;
  savedAt?: string;
  state: {
    run: SerializedRunV3;
    meta: SerializedMeta;
    equipment: SerializedEquipment;
    spellTree: SerializedSpellTree;
  };
}

interface LegacySaveEnvelopeV6 {
  version: 6;
  savedAt?: string;
  state: {
    run: SerializedRunV3;
    meta: SerializedMeta;
    equipment: SerializedEquipment;
    spellTree: SerializedSpellTree;
  };
}

export interface SaveEnvelopeV7 {
  version: 7;
  savedAt: string;
  state: {
    run: SerializedRunV3;
    meta: SerializedMeta;
    equipment: SerializedEquipment;
    spellTree: SerializedSpellTree;
    companions: SerializedCompanions;
  };
}

interface LegacySaveEnvelopeV1 {
  version: 1;
  savedAt?: string;
  state: { run: LegacySerializedRun; meta: SerializedMeta };
}

interface LegacySaveEnvelopeV2 {
  version: 2;
  savedAt?: string;
  state: { run: LegacySerializedRun; meta: SerializedMeta; equipment?: SerializedEquipment };
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
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > CURRENT_SAVE_VERSION) {
      throw new Error(`Unsupported Evercast save version: ${String(version)}`);
    }

    if (version === 1 || version === 2) {
      const envelope = raw as LegacySaveEnvelopeV1 | LegacySaveEnvelopeV2;
      const equipment =
        version === 2
          ? deserializeEquipment((envelope as LegacySaveEnvelopeV2).state.equipment)
          : createInitialEquipmentState();
      const state: GameState = {
        run: migrateLegacyRun(envelope.state.run),
        meta: deserializeMeta(envelope.state.meta),
        equipment,
        spellTree: createInitialSpellTreeState(),
        companions: createInitialCompanionsState(),
      };
      return {
        savedAt: new Date(envelope.savedAt ?? Date.now()),
        state: reconcileLegacyEssenceEconomy(state, this.config),
      };
    }

    if (version === 3) {
      const envelope = raw as LegacySaveEnvelopeV3;
      const state: GameState = {
        run: deserializeRunV3(envelope.state.run),
        meta: deserializeMeta(envelope.state.meta),
        equipment: deserializeEquipment(envelope.state.equipment),
        spellTree: createInitialSpellTreeState(),
        companions: createInitialCompanionsState(),
      };
      return {
        savedAt: new Date(envelope.savedAt ?? Date.now()),
        state: reconcileLegacyEssenceEconomy(state, this.config),
      };
    }

    if (version === 4) {
      const envelope = raw as LegacySaveEnvelopeV4;
      const state: GameState = {
        run: deserializeRunV3(envelope.state.run),
        meta: deserializeMeta(envelope.state.meta),
        equipment: deserializeEquipment(envelope.state.equipment),
        spellTree: deserializeSpellTree(envelope.state.spellTree, true),
        companions: createInitialCompanionsState(),
      };
      return {
        savedAt: new Date(envelope.savedAt ?? Date.now()),
        state: reconcileLegacyEssenceEconomy(state, this.config),
      };
    }

    const envelope = raw as SaveEnvelopeV7 | LegacySaveEnvelopeV6;
    const state: GameState = {
      run: deserializeRunV3(envelope.state.run),
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
  // `telegraphed` records that the renderer was told about a swing, which
  // cannot be true of a session that has not started yet.
  const { telegraphed: _presentationOnly, ...rest } = companion;
  return { ...rest, hp: companion.hp.toString(), maxHp: companion.maxHp.toString() };
}

function deserializeCompanion(companion: SerializedCompanion): CompanionCombatant {
  return { ...companion, hp: big(companion.hp), maxHp: big(companion.maxHp) };
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
  const { reward: _legacyReward, ...current } = enemy;
  return {
    ...current,
    hp: big(enemy.hp),
    maxHp: big(enemy.maxHp),
    attackDamage: big(enemy.attackDamage),
  };
}

function deserializeRunV3(run: SerializedRunV3): GameState['run'] {
  return {
    ...run,
    essence: big(run.essence),
    mage: { hp: big(run.mage.hp), maxHp: big(run.mage.maxHp) },
    enemies: Array.isArray(run.enemies) ? run.enemies.map(deserializeEnemy) : [],
    companions: Array.isArray(run.companions) ? run.companions.map(deserializeCompanion) : [],
    encounter: run.encounter ?? null,
    nextEnemyInstanceId: Math.max(1, run.nextEnemyInstanceId ?? 1),
  };
}

function migrateLegacyRun(run: LegacySerializedRun): GameState['run'] {
  const { enemy: _legacyEnemy, ...rest } = run;
  return {
    ...rest,
    phase: 'travel',
    travelElapsed: 0,
    castCooldown: 0,
    essence: big(run.essence),
    mage: { hp: big(run.mage.maxHp), maxHp: big(run.mage.maxHp) },
    enemies: [],
    // Saves this old predate companions; the party starts empty rather than
    // arriving undefined and failing the first time combat iterates it.
    companions: [],
    encounter: null,
    nextEnemyInstanceId: 1,
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

function reconcileLegacyEssenceEconomy(state: GameState, config: EngineConfig): GameState {
  const earnedBudget = totalFirstClearEssenceEarned(state.meta.highestStageEver, config.bossCadence);
  const requestedPurchased = Math.max(0, Math.floor(state.spellTree.purchasedPoints));
  let affordablePurchased = 0;
  let spent = big(0);

  while (affordablePurchased < requestedPurchased) {
    const cost = big(spellPointCost(affordablePurchased));
    if (spent.add(cost).cmp(earnedBudget) > 0) break;
    spent = spent.add(cost);
    affordablePurchased += 1;
  }

  const totalAffordablePoints = SPELL_TREE_STARTER_POINTS + affordablePurchased;
  state.spellTree = {
    purchasedPoints: affordablePurchased,
    // Nodes are stored in activation order, so a prefix preserves connected pathing.
    activatedNodeIds: state.spellTree.activatedNodeIds.slice(0, totalAffordablePoints),
  };
  state.run.essence = earnedBudget.sub(spent);
  state.run.spell = buildSpellFromTree(state.spellTree);
  return state;
}
