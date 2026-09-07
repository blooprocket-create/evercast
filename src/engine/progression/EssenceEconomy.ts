import Decimal from 'break_eternity.js';
import { big } from '../numbers';

// Playtest tuning: Arcane Essence is a finite first-clear progression reward.
// Gold remains the repeatable farming currency.
export const FIRST_CLEAR_ESSENCE_BASE = 2;
export const FIRST_CLEAR_ESSENCE_GROWTH = 1.08;
export const FIRST_CLEAR_BOSS_MULTIPLIER = 4;

export function firstClearEssenceReward(stage: number, boss: boolean): Decimal {
  const safeStage = Math.max(1, Math.floor(stage));
  const bossMultiplier = boss ? FIRST_CLEAR_BOSS_MULTIPLIER : 1;
  const reward = big(FIRST_CLEAR_ESSENCE_BASE)
    .mul(big(FIRST_CLEAR_ESSENCE_GROWTH).pow(safeStage - 1))
    .mul(bossMultiplier)
    .floor();
  return reward.cmp(1) < 0 ? big(1) : reward;
}

/**
 * highestStageEver is the next unbeaten frontier stage, so stages below it have
 * already been cleared at least once. This lets legacy saves reconstruct the
 * finite Essence budget without storing a giant claimed-stage list.
 */
export function totalFirstClearEssenceEarned(highestStageEver: number, bossCadence: number): Decimal {
  const highest = Math.max(1, Math.floor(highestStageEver));
  const cadence = Math.max(1, Math.floor(bossCadence));
  let total = big(0);
  for (let stage = 1; stage < highest; stage += 1) {
    total = total.add(firstClearEssenceReward(stage, stage % cadence === 0));
  }
  return total;
}
