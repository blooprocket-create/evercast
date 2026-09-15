/**
 * PLAYTEST defaults, not final balance. Centralized here for the same reason
 * `spellTreeTuning.ts` and `companionTuning.ts` are.
 *
 * These numbers describe the one moment in Evercast the player is asked to be
 * present for. Everything else in the game is decided in a menu and then
 * watched; a Surge is decided in the fight.
 */

/**
 * Every Nth boss swing is a Surge.
 *
 * Offset so the second swing of a boss fight is the first Surge: a mechanic the
 * player might not meet until the third encounter is a mechanic most players
 * never learn exists.
 */
export const SURGE_EVERY = 3;
export const SURGE_OFFSET = 1;

/**
 * How long a Surge is telegraphed.
 *
 * The ordinary telegraph is `enemyWindupSeconds` - 0.3s - which is a renderer
 * cue and not a window anyone could act inside. This is a window: long enough
 * to notice on a phone held one-handed, short enough that it is still a
 * reaction rather than a menu.
 *
 * Capped against the boss's own cadence so the telegraph cannot outlast the
 * swing it announces, and held under it so a boss still visibly rests between
 * Surges rather than reading as permanently wound up.
 */
export const SURGE_WINDUP_SECONDS = 2.2;
export const SURGE_WINDUP_CADENCE_SHARE = 0.9;

/** How long a countered boss reels. */
export const STAGGER_SECONDS = 4;

/**
 * Extra damage a staggered boss takes, as a fraction.
 *
 * This is the whole reward, and it is deliberately on the offensive side.
 * Cancelling the blow is already worth something defensively; making the
 * window *also* the best damage in the fight is what turns a Surge from an
 * interruption into something a player waits for.
 */
export const STAGGER_AMPLIFICATION = 0.5;

/** Charges held at once, and how long one takes to come back. */
export const COUNTER_MAX_CHARGES = 2;
export const COUNTER_RECHARGE_SECONDS = 15;
