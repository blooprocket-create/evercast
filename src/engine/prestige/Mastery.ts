import type Decimal from 'break_eternity.js';
import { MASTERY_EXPONENT, MASTERY_PIVOT } from '../../content/rebirthTuning';
import type { MetaState } from '../model';
import { big } from '../numbers';

/**
 * What every Rebirth so far is worth, as a multiplier on the mage.
 *
 * Read off lifetime Knowledge rather than the spendable balance. The balance
 * goes down when an attunement is bought, so keying power to it would mean
 * Schism costs the player damage - attunements and power would be substitutes,
 * and one of them would become a trap. Against the high-water mark they are
 * complements instead: pushing deeper before cashing out raises the multiplier
 * and the attunement budget in the same act, and spending the budget costs
 * nothing.
 *
 * Not read off `rebirths`, which is stage-independent and would pay the same for
 * a cash-out at 51 as at 500 - directly against `previewKnowledgeGain`, which
 * pays on depth. Not read off `highestStageEver` either: that would hand out
 * power mid-run, with no reset boundary to bound the feedback loop.
 */
export function masteryFromKnowledge(lifetimeKnowledge: Decimal): Decimal {
  return lifetimeKnowledge
    .max(0)
    .add(MASTERY_PIVOT)
    .div(MASTERY_PIVOT)
    .pow(MASTERY_EXPONENT)
    .max(1);
}

/**
 * One memo slot, compared by Decimal instance rather than by value.
 *
 * `meta.lifetimeKnowledge` is reassigned only by a Rebirth and by decoding a
 * save, so the hit rate is effectively total and a miss is merely a recompute -
 * the function stays pure and nothing about determinism depends on the memo. It
 * is here because this now sits in the combat hot path: the multiplier is read
 * once per cast and once per companion beat.
 */
let memoizedSource: Decimal | null = null;
let memoizedMastery: Decimal | null = null;

export function masteryMultiplier(meta: Pick<MetaState, 'lifetimeKnowledge'>): Decimal {
  if (memoizedMastery && memoizedSource === meta.lifetimeKnowledge) return memoizedMastery;
  const value = masteryFromKnowledge(meta.lifetimeKnowledge);
  memoizedSource = meta.lifetimeKnowledge;
  memoizedMastery = value;
  return value;
}

/**
 * What Mastery would become if the run cashed out for `gain` more Knowledge.
 *
 * Deliberately the unmemoized path: a preview is asked for while the current
 * value is still wanted, and routing both through one slot would only make them
 * evict each other.
 */
export function previewMastery(meta: Pick<MetaState, 'lifetimeKnowledge'>, gain: Decimal): Decimal {
  return masteryFromKnowledge(meta.lifetimeKnowledge.add(gain));
}

/** The multiplier a state with no Rebirths behind it has. Exactly one. */
export const NO_MASTERY = big(1);
