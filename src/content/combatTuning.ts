/**
 * PLAYTEST defaults, not final balance. Centralized here for the same reason
 * `spellTreeTuning.ts` and `companionTuning.ts` are.
 *
 * These numbers describe the one moment in Evercast the player is asked to be
 * present for. Everything else in the game is decided in a menu and then
 * watched; a Surge is decided in the fight.
 */

/**
 * Every Nth boss swing is a Surge, starting with the first.
 *
 * Measured with the greedy bot in `tools/balance/surge.test.ts`, over two
 * simulated hours to stage 100 and 129 boss encounters: every boss opens at
 * least one window at either offset, the first at stage 10 - a player's very
 * first boss. The offset decides how many follow, at 2.9 windows per boss from
 * 0 against 2.5 from 1, because at 0 the boss gathers on arrival instead of
 * having to survive a swing first.
 *
 * Worth recording how that was nearly got wrong. The first measurement used
 * hand-built saves with gear levels picked by hand, and reported that the
 * window opened almost never. Those saves were enormously over-geared for
 * their stage, so the boss died during its walk-in and never swung at all -
 * which says something true about an over-geared run and nothing whatsoever
 * about the game. Any question about how Evercast feels at a given depth has
 * to be asked of a run that bought its way there.
 */
export const SURGE_EVERY = 3;
export const SURGE_OFFSET = 0;

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
