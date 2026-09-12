import { describe, expect, it } from 'vitest';
import { addAwayDebt, awayDebt, creditTimeAtTheGate, setAwayDebt } from './runtime';

/**
 * The regression this file exists for.
 *
 * Away debt is measured once, while this module is evaluated. Everything after
 * that - the boot gate, the wait on assets, a title screen left open while
 * someone made coffee - used to be covered by nothing: the loop had not started,
 * so the time was never advanced live, and it was not in the debt either, so the
 * first save after Continue stamped `now` and erased it. An hour on the title
 * screen was an hour of progress gone.
 *
 * Importing `runtime` here is deliberate and safe: with no `localStorage` and no
 * `window` the store resolves to null and the audio engine no-ops, which is the
 * same path it takes on a server.
 *
 * One test rather than three, because the credit is idempotent through
 * module-level state: a second `it` would find it already spent and assert
 * nothing at all. The sequence below is the only order in which each claim is
 * still live when it is made.
 */
describe('time at the boot gate', () => {
  it('credits the wait exactly once, on top of what boot already owed', () => {
    const BEFORE_BOOT = 3_600;
    setAwayDebt(0);
    addAwayDebt(BEFORE_BOOT);

    creditTimeAtTheGate();
    const credited = awayDebt();

    // Adds rather than replaces: the two intervals are adjacent, not
    // overlapping - save to boot, then boot to Begin - and one settlement on
    // the first frame has to pay off both.
    expect(credited).toBeGreaterThan(BEFORE_BOOT);
    // Bounded, so a wild clock reads as a failure rather than a windfall.
    expect(credited).toBeLessThan(BEFORE_BOOT + 600);

    // `beginPlaying` credits on the click, and the loop effect re-runs whenever
    // the scene rebuilds. A second charge would pay the player twice for one wait.
    creditTimeAtTheGate();
    creditTimeAtTheGate();
    expect(awayDebt()).toBe(credited);
  });
});
