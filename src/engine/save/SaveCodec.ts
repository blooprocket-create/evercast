import type { EngineConfig } from '../config';
import { createInitialEquipmentState } from '../gear/GearSystem';
import { GEAR_SLOT_ORDER } from '../gear/GearCatalog';
import type { EquipmentState, GearPieceState, GearSlot } from '../gear/types';
import type { EnemyState, GameState } from '../model';
import { big } from '../numbers';
import { totalFirstClearEssenceEarned } from '../progression/EssenceEconomy';
import { SPELL_TREE_NODE_BY_ID, SPELL_TREE_STARTER_POINTS, spellPointCost } from '../spellTree/SpellTreeCatalog';
import { buildSpellFromTree, createInitialSpellTreeState } from '../spellTree/SpellTreeSystem';
import type { SpellTreeState } from '../spellTree/types';
import { createInitialGameState } from '../state';

export const CURRENT_SAVE_VERSION = 5;

type SerializedEnemy = Omit<EnemyState, 'hp' | 'maxHp' | 'attackDamage' | 'reward'> & {
  hp: string;
  maxHp: string;
  attackDamage: string;
  reward: string;
};

type SerializedRunV3 = Omit<GameState['run'], 'essence' | 'mage' | 'enemies'> & {
  essence: string;
  mage: { hp: string; maxHp: string };
  enemies: SerializedEnemy[];
};

type LegacyEnemy = Omit<EnemyState, 'instanceId' | 'hp' | 'maxHp' | 'attackDamage' | 'reward'> & {
  hp: string;
  maxHp: string;
  attackDamage: string;
  reward: string;
};

type LegacySerializedRun = Omit<GameState['run'], 'essence' | 'mage' | 'enemies' | 'encounter' | 'nextEnemyInstanceId'> & {
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

export interface SaveEnvelopeV5 {
  version: 5;
  savedAt: string;
  state: {
    run: SerializedRunV3;
    meta: SerializedMeta;
    equipment: SerializedEquipment;
    spellTree: SerializedSpellTree;
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

  encode(state: GameState, savedAt = new Date()): SaveEnvelopeV5 {
    return {
      version: CURRENT_SAVE_VERSION,
      savedAt: savedAt.toISOString(),
      state: {
        run: {
          ...state.run,
          essence: state.run.essence.toString(),
          mage: {
            hp: state.run.mage.hp.toString(),
            maxHp: state.run.mage.maxHp.toString(),
          },
          enemies: state.run.enemies.map(serializeEnemy),
        },
        meta: {
          ...state.meta,
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
      },
    };
  }

  decode(raw: unknown): { state: GameState; savedAt: Date } {
    if (!raw || typeof raw !== 'object') {
      return { state: createInitialGameState(this.config), savedAt: new Date() };
    }

    const version = (raw as { version?: unknown }).version;
    if (version !== 1 && version !== 2 && version !== 3 && version !== 4 && version !== 5) {
      throw new Error(`Unsupported Evercast save version: ${String(version)}`);
    }

    if (version === 1 || version === 2) {
      const envelope = raw as LegacySaveEnvelopeV1 | LegacySaveEnvelopeV2;
      const equipment = version === 2
        ? deserializeEquipment((envelope as LegacySaveEnvelopeV2).state.equipment)
        : createInitialEquipmentState();
      const state: GameState = {
        run: migrateLegacyRun(envelope.state.run),
        meta: deserializeMeta(envelope.state.meta),
        equipment,
        spellTree: createInitialSpellTreeState(),
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
        spellTree: deserializeSpellTree(envelope.state.spellTree),
      };
      return {
        savedAt: new Date(envelope.savedAt ?? Date.now()),
        state: reconcileLegacyEssenceEconomy(state, this.config),
      };
    }

    const envelope = raw as SaveEnvelopeV5;
    return {
      savedAt: new Date(envelope.savedAt ?? Date.now()),
      state: {
        run: deserializeRunV3(envelope.state.run),
        meta: deserializeMeta(envelope.state.meta),
        equipment: deserializeEquipment(envelope.state.equipment),
        spellTree: deserializeSpellTree(envelope.state.spellTree),
      },
    };
  }
}

function serializeEnemy(enemy: EnemyState): SerializedEnemy {
  return {
    ...enemy,
    hp: enemy.hp.toString(),
    maxHp: enemy.maxHp.toString(),
    attackDamage: enemy.attackDamage.toString(),
    reward: enemy.reward.toString(),
  };
}

function deserializeEnemy(enemy: SerializedEnemy): EnemyState {
  return {
    ...enemy,
    hp: big(enemy.hp),
    maxHp: big(enemy.maxHp),
    attackDamage: big(enemy.attackDamage),
    reward: big(enemy.reward),
  };
}

function deserializeRunV3(run: SerializedRunV3): GameState['run'] {
  return {
    ...run,
    essence: big(run.essence),
    mage: { hp: big(run.mage.hp), maxHp: big(run.mage.maxHp) },
    enemies: Array.isArray(run.enemies) ? run.enemies.map(deserializeEnemy) : [],
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
      treeNodes: Array.isArray(saved.treeNodes) ? saved.treeNodes.filter((node): node is string => typeof node === 'string') : [],
    };
  }
  return equipment;
}

function deserializeSpellTree(serialized: SerializedSpellTree | undefined): SpellTreeState {
  if (!serialized) return createInitialSpellTreeState();
  const activatedNodeIds = Array.isArray(serialized.activatedNodeIds)
    ? [...new Set(serialized.activatedNodeIds.filter((nodeId): nodeId is string => typeof nodeId === 'string' && SPELL_TREE_NODE_BY_ID.has(nodeId)))]
    : [];
  const savedPurchased = Number.isFinite(serialized.purchasedPoints)
    ? Math.max(0, Math.floor(serialized.purchasedPoints))
    : 0;
  const purchasedPoints = Math.max(savedPurchased, Math.max(0, activatedNodeIds.length - SPELL_TREE_STARTER_POINTS));
  return { purchasedPoints, activatedNodeIds };
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
