import type Decimal from 'break_eternity.js';
// prettier-ignore
import { STARLIGHT_BOSS_MULTIPLIER, STARLIGHT_FIRST_CLEAR, STARLIGHT_PER_KILL } from '../../content/companionTuning';
import { big } from '../numbers';

/**
 * Starlight is the summoning currency, and it is deliberately its own economy.
 *
 * Gold is repeatable and levels gear; Arcane Essence is finite and buys Spell
 * Points on a first clear only. Paying for draws out of either would make the
 * gacha either cannibalise gear or quietly break the rule that farming grants
 * no Essence. So summons get a third wallet, earned the way Gold is - from
 * kills - which keeps the collection loop feeding off the combat loop.
 *
 * It grows far more slowly than Gold per kill: a draw should be an occasion.
 */
export function starlightRewardForKill(stage: number, boss: boolean): Decimal {
  const safeStage = Math.max(1, Math.floor(stage));
  const multiplier = boss ? STARLIGHT_BOSS_MULTIPLIER : 1;
  const reward = big(STARLIGHT_PER_KILL)
    .mul(Math.sqrt(safeStage))
    .mul(multiplier)
    .floor();
  return reward.cmp(1) < 0 ? big(1) : reward;
}

/** A one-off bonus the first time a frontier stage falls. */
export function firstClearStarlightReward(stage: number, boss: boolean): Decimal {
  const safeStage = Math.max(1, Math.floor(stage));
  return big(STARLIGHT_FIRST_CLEAR)
    .mul(Math.sqrt(safeStage))
    .mul(boss ? 3 : 1)
    .floor();
}
