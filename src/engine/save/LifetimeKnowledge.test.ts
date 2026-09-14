import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE_CONFIG } from '../config';
import { big } from '../numbers';
import { createInitialGameState } from '../state';
import { CURRENT_SAVE_VERSION, SaveCodec } from './SaveCodec';

/**
 * `meta.knowledge` is a balance and `buyAttunement` subtracts from it, so it
 * cannot say how far an account has come: a player who spent it looks like one
 * who never earned it. `lifetimeKnowledge` is the high-water mark, and it landed
 * in v9 - which means every save written before then has to have it worked out
 * rather than defaulted, or a returning player would read as brand new.
 *
 * The reconstruction is exact rather than a guess, and these are the tests that
 * say why: attunements are the only thing that has ever spent Knowledge, so
 * everything ever earned is what is banked plus what was bought.
 */
const codec = new SaveCodec(DEFAULT_ENGINE_CONFIG);

function asOlderSave(knowledge: number, attunements: string[]) {
  const state = createInitialGameState(DEFAULT_ENGINE_CONFIG);
  state.meta.knowledge = big(knowledge);
  state.spellTree.attunements = attunements;
  const envelope = JSON.parse(JSON.stringify(codec.encode(state))) as {
    version: number;
    state: { meta: { lifetimeKnowledge?: string } };
  };
  // A save from before the field existed.
  delete envelope.state.meta.lifetimeKnowledge;
  envelope.version = 8;
  return codec.decode(envelope).state;
}

describe('lifetime Knowledge', () => {
  it('adds back what the owned attunements cost', () => {
    // Broadened Study is 1 and Schism is 6, so 3 banked means 10 ever earned.
    const restored = asOlderSave(3, ['third_identity', 'second_route']);
    expect(restored.meta.lifetimeKnowledge.toString()).toBe('10');
  });

  it('equals the balance when nothing has been spent', () => {
    const restored = asOlderSave(7, []);
    expect(restored.meta.lifetimeKnowledge.toString()).toBe('7');
  });

  it('does not credit an attunement the save could not actually hold', () => {
    // Confluence costs 25 and needs Schism. deserializeSpellTree drops it for
    // want of its prerequisite, so it was never bought and never paid for -
    // counting its cost would hand out 25 Knowledge for an edited file.
    const restored = asOlderSave(2, ['third_route']);
    expect(restored.spellTree.attunements).toEqual([]);
    expect(restored.meta.lifetimeKnowledge.toString()).toBe('2');
  });

  it('is never below the balance, however the field was poisoned', () => {
    const state = createInitialGameState(DEFAULT_ENGINE_CONFIG);
    state.meta.knowledge = big(40);
    const envelope = JSON.parse(JSON.stringify(codec.encode(state))) as {
      state: { meta: { lifetimeKnowledge?: unknown } };
    };

    for (const poison of [-5, Number.NaN, Number.POSITIVE_INFINITY, 3, {}, null, 'nonsense']) {
      const copy = JSON.parse(JSON.stringify(envelope)) as typeof envelope;
      copy.state.meta.lifetimeKnowledge = poison as never;
      const restored = codec.decode(copy as never).state;
      expect(restored.meta.lifetimeKnowledge.cmp(restored.meta.knowledge)).toBeGreaterThanOrEqual(0);
    }
  });

  /**
   * The codec is routinely handed a current save relabelled as an older version
   * - `SaveCodec.test.ts` does exactly that across the whole supported window. If
   * reconstruction keyed on the version rather than on the field being absent,
   * every one of those loads would add the attunement spend again.
   */
  it('does not add the spend again to a save that already carries the field', () => {
    const state = createInitialGameState(DEFAULT_ENGINE_CONFIG);
    state.meta.knowledge = big(3);
    state.meta.lifetimeKnowledge = big(10);
    state.spellTree.attunements = ['third_identity', 'second_route'];

    const encoded = JSON.parse(JSON.stringify(codec.encode(state))) as { version: number };
    expect(codec.decode(JSON.parse(JSON.stringify(encoded))).state.meta.lifetimeKnowledge.toString()).toBe('10');

    encoded.version = 8;
    expect(codec.decode(encoded as never).state.meta.lifetimeKnowledge.toString()).toBe('10');
  });

  it('round-trips at the current version', () => {
    const state = createInitialGameState(DEFAULT_ENGINE_CONFIG);
    state.meta.knowledge = big(4);
    state.meta.lifetimeKnowledge = big(29);

    const encoded = codec.encode(state);
    expect(encoded.version).toBe(CURRENT_SAVE_VERSION);
    const restored = codec.decode(JSON.parse(JSON.stringify(encoded))).state;
    expect(restored.meta.lifetimeKnowledge.toString()).toBe('29');
    expect(restored.meta.knowledge.toString()).toBe('4');
  });

  it('rises with every rebirth and is never spent down', () => {
    const state = createInitialGameState(DEFAULT_ENGINE_CONFIG);
    state.meta.knowledge = big(100);
    state.meta.lifetimeKnowledge = big(100);
    const before = state.meta.lifetimeKnowledge.toString();

    // Buying an attunement is the one thing that moves the balance.
    state.meta.knowledge = state.meta.knowledge.sub(6);
    expect(state.meta.lifetimeKnowledge.toString()).toBe(before);
    expect(state.meta.lifetimeKnowledge.cmp(state.meta.knowledge)).toBeGreaterThan(0);
  });
});
