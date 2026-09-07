import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE_CONFIG } from '../config';
import { big } from '../numbers';
import { totalFirstClearEssenceEarned } from '../progression/EssenceEconomy';
import { spellPointCost } from '../spellTree/SpellTreeCatalog';
import { createInitialGameState } from '../state';
import { SaveCodec } from './SaveCodec';

function affordablePurchasedPoints(budget: ReturnType<typeof big>, requested: number) {
  let spent = big(0);
  let purchased = 0;
  while (purchased < requested) {
    const cost = big(spellPointCost(purchased));
    if (spent.add(cost).cmp(budget) > 0) break;
    spent = spent.add(cost);
    purchased += 1;
  }
  return { purchased, spent };
}

describe('SaveCodec Essence economy migration', () => {
  it('caps v4 AFK-earned Essence and Spell Points to the first-clear frontier budget', () => {
    const codec = new SaveCodec(DEFAULT_ENGINE_CONFIG);
    const state = createInitialGameState(DEFAULT_ENGINE_CONFIG);
    state.meta.highestStageEver = 8; // stages 1-7 have actually been cleared once
    state.run.frontierStage = 8;
    state.run.essence = big('999999999');
    state.spellTree.purchasedPoints = 30;

    const encoded = codec.encode(state, new Date('2026-09-07T00:00:00Z')) as unknown as {
      version: number;
      state: { run: { essence: string }; spellTree: { purchasedPoints: number } };
    };
    encoded.version = 4;

    const decoded = codec.decode(JSON.parse(JSON.stringify(encoded)));
    const budget = totalFirstClearEssenceEarned(8, DEFAULT_ENGINE_CONFIG.bossCadence);
    const expected = affordablePurchasedPoints(budget, 30);

    expect(decoded.state.spellTree.purchasedPoints).toBe(expected.purchased);
    expect(decoded.state.run.essence.toString()).toBe(budget.sub(expected.spent).toString());
    expect(decoded.state.run.essence.cmp(budget)).toBeLessThanOrEqual(0);
  });
});
