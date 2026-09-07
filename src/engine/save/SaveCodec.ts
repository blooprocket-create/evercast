import type { EngineConfig } from '../config';
import type { GameState } from '../model';
import { big } from '../numbers';
import { createInitialGameState } from '../state';

export const CURRENT_SAVE_VERSION = 1;

export interface SaveEnvelopeV1 {
  version: 1;
  savedAt: string;
  state: {
    run: Omit<GameState['run'], 'essence' | 'mage' | 'enemy'> & {
      essence: string;
      mage: { hp: string; maxHp: string };
      enemy: null | Omit<NonNullable<GameState['run']['enemy']>, 'hp' | 'maxHp' | 'attackDamage' | 'reward'> & {
        hp: string;
        maxHp: string;
        attackDamage: string;
        reward: string;
      };
    };
    meta: Omit<GameState['meta'], 'knowledge'> & { knowledge: string };
  };
}

export class SaveCodec {
  constructor(private readonly config: EngineConfig) {}

  encode(state: GameState, savedAt = new Date()): SaveEnvelopeV1 {
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
      },
    };
  }

  decode(raw: unknown): { state: GameState; savedAt: Date } {
    if (!raw || typeof raw !== 'object') {
      return { state: createInitialGameState(this.config), savedAt: new Date() };
    }
    const envelope = raw as Partial<SaveEnvelopeV1>;
    if (envelope.version !== 1 || !envelope.state) {
      throw new Error(`Unsupported Evercast save version: ${String(envelope.version)}`);
    }

    const run = envelope.state.run;
    const meta = envelope.state.meta;
    return {
      savedAt: new Date(envelope.savedAt ?? Date.now()),
      state: {
        run: {
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
        },
        meta: {
          ...meta,
          knowledge: big(meta.knowledge),
        },
      },
    };
  }
}
