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
   * The furthest reading handed out by `claim` and not yet paid for.
   *
   * In memory only, and that is the point: a session that dies before settling
   * forgets it, which is what leaves the absence owed rather than consumed. It
   * still floors successive claims within a session, so boot and the wait at
   * the gate bill for their own interval instead of the same one twice.
   */
  private reserved = 0;

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
   * Raises the persisted mark to `at`, never lowers it.
   *
   * This is the commit: everything before `at` is now paid for and can never be
   * credited again.
   */
  observe(at: number): void {
    if (!Number.isFinite(at) || at <= this.mark) return;
    this.mark = at;
    this.write(at);
  }

  /** The latest wall-clock reading this installation has been *paid* for. */
  highWaterMark(): number {
    return this.mark;
  }

  /**
   * Commits everything claimed so far, because the debt it represents has now
   * been simulated.
   *
   * Called by the game loop once `OfflineProgressor` has actually applied the
   * away time - never on the path where applying it threw, so a failed
   * settlement leaves the absence owed instead of swallowing it.
   */
  settle(): void {
    this.observe(this.reserved);
  }

  /**
   * The seconds of absence that may be credited for a session last seen at
   * `stamp`, reserved but not yet consumed. Nothing is persisted here: `settle`
   * is what makes the claim permanent, once the debt has actually been paid.
   *
   * Returns zero rather than a negative number when the clock has moved
   * backwards, which is both the honest answer and what stops a rollback being
   * worth anything.
   */
  claim(stamp: number): number {
    const now = this.now();
    if (!Number.isFinite(now)) return 0;
    // Three floors, and the latest of them wins. The persisted mark is time
    // already paid for. `stamp` is the save's own account of when it was last
    // written - a floor rather than the answer, so a blob claiming to be from
    // last year buys nothing, and a wiped clock key still has somewhere to
    // start. `reserved` is what this session has already handed out.
    const since = Math.max(this.mark, Number.isFinite(stamp) ? stamp : 0, this.reserved);
    this.reserved = Math.max(this.reserved, now);
    const seconds = (now - since) / 1000;
    if (!Number.isFinite(seconds) || seconds <= 0) return 0;
    return Math.min(seconds, this.maxSeconds);
  }
}
