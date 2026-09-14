/**
 * PLAYTEST defaults, not final balance. Centralized here for the same reason
 * `spellTreeTuning.ts` and `companionTuning.ts` are.
 *
 * A Rebirth used to pay Knowledge and nothing else, which made it a pure reset
 * with a currency attached - the frontier went back to 1 and the account got no
 * stronger for it. Mastery is the power half of that bargain: a permanent
 * multiplier on the mage, and through her on the whole party.
 */

/**
 * Knowledge at which Mastery has climbed by one step of the curve. Sets how much
 * the first few points are worth without touching the late slope.
 */
export const MASTERY_PIVOT = 1;

/**
 * The late-game slope, deliberately conservative.
 *
 * Mastery applies to health as well as damage, so the survival margin moves as
 * the square of it - a time-per-stage model does not see that, and a number
 * chosen against one would be too generous in play. If it proves too weak, the
 * first thing to try is not raising this: it is applying the square root to
 * health while damage keeps the whole multiplier.
 */
export const MASTERY_EXPONENT = 0.5;
