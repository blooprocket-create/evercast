import type Decimal from 'break_eternity.js';
import { big } from '../numbers';

/**
 * What the run is earning, per second of simulated time.
 *
 * An incremental game is a set of rates, and this one showed none of them. The
 * player could read a gold balance in `e`-notation and a gear price in
 * `e`-notation and had no way to answer "how long is that" without doing the
 * arithmetic themselves - which is the one question every purchase in the game
 * is actually about.
 *
 * Measured rather than derived. A derived figure would have to model kill
 * speed, wave size, spawn cadence, the farm/push split and every multiplier
 * that touches them; what the player wants to know is what the run is actually
 * producing, including the part where it is stuck on a frontier it cannot beat.
 *
 * Decimal throughout, because gold per second passes 1e308 long before the run
 * is over and a JS number stops being a number there.
 */

/**
 * How long a sample is before it folds into the average.
 *
 * A step can be microseconds - the loop steps to the next event, not on a
 * fixed tick - so dividing every step's takings by its own duration would
 * produce a rate of 1e60 per second from one kill that happened to land on a
 * short step. A second of simulated time is long enough to be a rate.
 */
const SAMPLE_SECONDS = 1;

/**
 * The averaging period - long enough to ride out the gap between waves, short
 * enough that a player who has just bought a gear tier sees it move.
 */
const TAU_SECONDS = 25;

/** Below this the meter says nothing rather than reporting a cold start. */
const WARM_SECONDS = 4;

export class RateMeter<Key extends string> {
  private readonly rates = new Map<Key, Decimal>();
  private readonly pending = new Map<Key, Decimal>();
  private sampleSeconds = 0;
  private observedSeconds = 0;

  /** Everything earned since the last fold. Called once per event. */
  add(key: Key, amount: Decimal | string): void {
    const value = big(amount);
    const current = this.pending.get(key);
    this.pending.set(key, current ? current.add(value) : value);
  }

  /**
   * Advances simulated time. Folds a sample once a whole one has passed, so
   * the fold rate is one a second however small the engine's steps are.
   */
  tick(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    this.sampleSeconds += seconds;
    this.observedSeconds += seconds;
    if (this.sampleSeconds < SAMPLE_SECONDS) return;

    const elapsed = this.sampleSeconds;
    this.sampleSeconds = 0;
    // The weight a sample of this length carries. Exponential rather than a
    // ring of buckets: an offline settle folds a thousand samples in one call,
    // and a ring would have to be as long as the window in samples.
    const alpha = 1 - Math.exp(-elapsed / TAU_SECONDS);

    for (const key of new Set([...this.rates.keys(), ...this.pending.keys()])) {
      const earned = this.pending.get(key) ?? big(0);
      const instant = earned.div(elapsed);
      const previous = this.rates.get(key) ?? big(0);
      this.rates.set(key, previous.add(instant.sub(previous).mul(alpha)));
    }
    this.pending.clear();
  }

  /**
   * The current rate, or null while the meter is still cold - a resumed save
   * starts one from nothing, and a made-up number is worse than no number.
   */
  read(key: Key): Decimal | null {
    if (this.observedSeconds < WARM_SECONDS) return null;
    return this.rates.get(key) ?? big(0);
  }
}
