import type { EngineConfig } from '../config';
import { createInitialEquipmentState } from '../gear/GearSystem';
import { GEAR_SLOT_ORDER } from '../gear/GearCatalog';
import type { EquipmentState, GearPieceState, GearSlot } from '../gear/types';
import type { GameState } from '../model';
import { big } from '../numbers';
import { createInitialGameState } from '../state';

export const CURRENT_SAVE_VERSION = 2;

type SerializedRun = Omit<GameState['run'], 'essence' | 'mage' | 'enemy'> & {
  essence: string;
  mage: { hp: string; maxHp: string };
  enemy: null | Omit<NonNullable<GameState['run']['enemy']>, 'hp' | 'maxHp' | 'attackDamage' | 'reward'> & {
    hp: string;
    maxHp: string;
    attackDamage: string;
    reward: string;
  };
};

type SerializedMeta = Omit<GameState['meta'], 'knowledge'> & { knowledge: string };

interface SerializedEquipment {
  gold: string;
  pieces: Record<GearSlot, GearPieceState>;
}

export interface SaveEnvelopeV2 {
  version: 2;
  savedAt: string;
  state: {
    run: SerializedRun;
    meta: SerializedMeta;
    equipment: SerializedEquipment;
  };
}

interface LegacySaveEnvelopeV1 {
  version: 1;
  savedAt?: string;
  state: {
    run: SerializedRun;
    meta: SerializedMeta;
  };
}

export class SaveCodec {
  constructor(private readonly config: EngineConfig) {}

  encode(state: GameState, savedAt = new Date()): SaveEnvelopeV2 {
    const enemy = state.run.enemy;
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
          enemy: enemy
            ? {
                ...enemy,
                hp: enemy.hp.toString(),
                maxHp: enemy.maxHp.toString(),
                attackDamage: enemy.attackDamage.toString(),
                reward: enemy.reward.toString(),
              }
            : null,
        },
        meta: {
          ...state.meta,
          knowledge: state.meta.knowledge.toString(),
        },
        equipment: {
          gold: state.equipment.gold.toString(),
          pieces: structuredClone(state.equipment.pieces),
        },
      },
    };
  }

  decode(raw: unknown): { state: GameState; savedAt: Date } {
    if (!raw || typeof raw !== 'object') {
      return { state: createInitialGameState(this.config), savedAt: new Date() };
    }

    const version = (raw as { version?: unknown }).version;
    if (version !== 1 && version !== 2) {
      throw new Error(`Unsupported Evercast save version: ${String(version)}`);
    }

    if (version === 1) {
      const envelope = raw as LegacySaveEnvelopeV1;
      return {
        savedAt: new Date(envelope.savedAt ?? Date.now()),
        state: {
          run: deserializeRun(envelope.state.run),
          meta: deserializeMeta(envelope.state.meta),
          equipment: createInitialEquipmentState(),
        },
      };
    }

    const envelope = raw as SaveEnvelopeV2;
    return {
      savedAt: new Date(envelope.savedAt ?? Date.now()),
      state: {
        run: deserializeRun(envelope.state.run),
        meta: deserializeMeta(envelope.state.meta),
        equipment: deserializeEquipment(envelope.state.equipment),
      },
    };
  }
}

function deserializeRun(run: SerializedRun): GameState['run'] {
  return {
    ...run,
    essence: big(run.essence),
    mage: {
      hp: big(run.mage.hp),
      maxHp: big(run.mage.maxHp),
    },
    enemy: run.enemy
      ? {
          ...run.enemy,
          hp: big(run.enemy.hp),
          maxHp: big(run.enemy.maxHp),
          attackDamage: big(run.enemy.attackDamage),
          reward: big(run.enemy.reward),
        }
      : null,
  };
}

function deserializeMeta(meta: SerializedMeta): GameState['meta'] {
  return {
    ...meta,
    knowledge: big(meta.knowledge),
  };
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
