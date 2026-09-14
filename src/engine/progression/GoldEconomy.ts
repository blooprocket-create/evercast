import type Decimal from 'break_eternity.js';
import { GOLD_BOSS_MULTIPLIER, GOLD_HP_FRACTION } from '../../content/gear';

/**
 * Gold is the repeatable farming currency, and it is paid out of the health of
 * the thing that died.
 *
 * It used to be `stage x 1`. That is linear, and enemy health compounds, so the
 * gap between what a stage cost and what it paid widened with every stage -
 * farming one stage below a wall could never fund passing it, no matter how long
 * it ran. Paying a fraction of the enemy's own maximum health couples income to
 * difficulty by construction: the world-tier and boss multipliers that make an
 * enemy harder now make it richer in the same breath, with no separate income
 * rule to keep in sync.
 *
 * The floor at 1 matters more than it looks. Early enemies have single-digit
 * health, so the fraction rounds to nothing; without it the opening minutes pay
 * literally zero gold.
 *
 * This lives beside `EssenceEconomy` and `StarlightEconomy` because it is the
 * third of the three wallets, not because it is about gear. It used to sit in
 * `GearSystem` for the accident that gear is what gold buys.
 */
export function goldRewardForKill(maxHp: Decimal, boss: boolean): Decimal {
  return maxHp
    .mul(GOLD_HP_FRACTION)
    .mul(boss ? GOLD_BOSS_MULTIPLIER : 1)
    .floor()
    .max(1);
}
