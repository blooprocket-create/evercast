/**
 * The one place away time is measured, and the reason it cannot be farmed.
 *
 * ## The exploit this closes
 *
 * An idle game pays for absence, and the only clock a browser game has is the
 * one the player owns. Before this, every route into offline progress read
 * `Date.now()` and subtracted: the save's stamp on boot, the moment the tab was
 * hidden, the time spent at the boot gate. So a system clock moved a day
 * forward was a day of progress, a reload away, as often as anyone cared to do
 * it - and a save file with a backdated `savedAt` was the same thing without
 * even touching the clock.
 *
 * ## The fix, and exactly how far it goes
 *
 * A high-water mark: the latest wall-clock reading this installation has ever
 * seen, kept monotonic and consulted for every measurement. Time is credited
 * from the mark rather than from whatever stamp the caller brought, and the
 * mark only ever moves forward.
 *
 * That turns an unbounded exploit into a bounded one. Jumping the clock a day
 * forward still pays a day - it is indistinguishable from a day away, and
 * always will be without a server to ask - but it also drags the mark a day
 * into the future. Jumping back pays nothing and lowers nothing. Toggling back
 * and forth pays nothing after the first move.
 *
 * The guarantee, stated precisely, is that **no second is ever credited twice**:
 * total time credited over an installation's life cannot exceed the span
 * between the first and the furthest clock reading it has ever seen. A player
 * who pushes the clock forward a week is paid for a week - and has then spent
 * that week, because nothing is credited again until real time passes the mark
 * they left behind. Progress can be pulled forward; it cannot be manufactured.
 *
 * What this is deliberately not: a claim that the clock cannot be cheated at
 * all. One jump forward pays out exactly what the game already gives away for
 * a legitimate absence of the same length, and capping that harder would
 * punish the player who really was away for a day. A save's own stamp acts as
 * a floor on the mark, so clearing this key falls back to the save's account
 * of when it was written - which its digest covers - rather than to an open
 * door.
 */

/** The slice of `Storage` this needs, so a test does not need a browser. */
export type ClockStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const AWAY_CLOCK_KEY = 'evercast.clock.v1';

export class AwayClock {
  private mark: number;

  /**
   * `storage` is injected for the same reason the save store's is: reaching for
   * it is itself a throwing operation on an opaque origin, and this runs while
   * the module graph is still evaluating.
   */
  constructor(
    private readonly storage: ClockStorage | null,
    private readonly maxSeconds: number,
    private readonly key = AWAY_CLOCK_KEY,
    private readonly now: () => number = Date.now,
  ) {
    this.mark = this.read();
  }

  private read(): number {
    try {
      const raw = this.storage?.getItem(this.key);
      const parsed = raw === null || raw === undefined ? Number.NaN : Number(raw);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    } catch {
      // A blocked or corrupt key is not worth a crash on boot; it just means
      // the floor below is whatever the save itself claims.
      return 0;
    }
  }

  private write(value: number): void {
    try {
      this.storage?.setItem(this.key, String(value));
    } catch {
      // Private browsing and full quotas are not errors the player can act on.
    }
  }

  /**
   * Raises the mark to `at`, never lowers it.
   *
   * A save's own stamp is passed through here on load so that clearing this
   * key leaves the save as the floor rather than leaving no floor at all.
   */
  observe(at: number): void {
    if (!Number.isFinite(at) || at <= this.mark) return;
    this.mark = at;
    this.write(at);
  }

  /** The latest wall-clock reading this installation has ever seen. */
  highWaterMark(): number {
    return this.mark;
  }

  /**
   * The seconds of absence that may be credited for a session that was last
   * seen at `stamp`, and the side effect of having now seen the current time.
   *
   * Returns zero rather than a negative number when the clock has moved
   * backwards, which is both the honest answer and what stops a rollback being
   * worth anything.
   */
  claim(stamp: number): number {
    const now = this.now();
    // The stamp is a floor on the mark: it came out of a save whose digest
    // covers it, so a blob claiming to be from last year moves nothing.
    this.observe(stamp);
    const since = this.mark;
    this.observe(now);
    if (!Number.isFinite(now) || !Number.isFinite(since)) return 0;
    const seconds = (now - since) / 1000;
    if (!Number.isFinite(seconds) || seconds <= 0) return 0;
    return Math.min(seconds, this.maxSeconds);
  }
}
