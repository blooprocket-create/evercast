import type Decimal from 'break_eternity.js';
// prettier-ignore
import { STARLIGHT_PER_BOSS_KILL, STARLIGHT_PER_KILL } from '../../content/companionTuning';
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
 * Unlike Gold it does not scale. It used to grow with the square root of the
 * stage, which meant a draw cost less the further you pushed and the price
 * stopped meaning anything; a kill is now worth a kill wherever it happens,
 * and only a boss is worth more. There is no first-clear bonus for the same
 * reason - it was the largest scaling source of all.
 */
export function starlightRewardForKill(_stage: number, boss: boolean): Decimal {
  return big(boss ? STARLIGHT_PER_BOSS_KILL : STARLIGHT_PER_KILL);
}
