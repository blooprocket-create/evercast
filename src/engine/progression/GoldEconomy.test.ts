import { describe, expect, it } from 'vitest';
import { GOLD_BOSS_MULTIPLIER, GOLD_HP_FRACTION } from '../../content/gear';
import { big } from '../numbers';
import { goldRewardForKill } from './GoldEconomy';

/**
 * Gold used to be `stage x 1` against enemy health that compounds, so farming
 * below a wall could never fund passing it. It is now a fraction of what died.
 * These guard the two things that rule can get wrong: losing the coupling, and
 * paying nothing at all in the opening minutes.
 */
describe('goldRewardForKill', () => {
  it('pays a fraction of the enemy that died', () => {
    const reward = goldRewardForKill(big(10_000), false);
    expect(reward.toNumber()).toBe(Math.floor(10_000 * GOLD_HP_FRACTION));
  });

  it('scales with enemy health, so a deeper stage pays more for the same kill', () => {
    const shallow = goldRewardForKill(big(10_000), false);
    const deep = goldRewardForKill(big(1_000_000), false);
    expect(deep.cmp(shallow)).toBeGreaterThan(0);

    // Exactly in proportion: the world-tier and boss multipliers that make an
    // enemy harder are inherited as income without a rule of their own.
    expect(deep.div(shallow).toNumber()).toBeCloseTo(100, 6);
  });

  it('pays a boss more than the ordinary kill its health already makes it', () => {
    const ordinary = goldRewardForKill(big(10_000), false);
    const boss = goldRewardForKill(big(10_000), true);
    expect(boss.div(ordinary).toNumber()).toBeCloseTo(GOLD_BOSS_MULTIPLIER, 6);
  });

  /**
   * The floor is not defensive tidiness. A stage-1 enemy has about four health,
   * six percent of which floors to zero - without this the first minutes of a
   * new game pay literally nothing and no gear level is ever reachable.
   */
  it('never pays nothing, however small the enemy', () => {
    expect(goldRewardForKill(big(4), false).toNumber()).toBe(1);
    expect(goldRewardForKill(big(1), false).toNumber()).toBe(1);
    expect(goldRewardForKill(big(0), false).toNumber()).toBe(1);
  });
});
