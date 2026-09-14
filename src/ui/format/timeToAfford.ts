import { big } from '../../engine/numbers';

/**
 * How long until the run can pay for something.
 *
 * An incremental game is a set of rates, and this one asked the player to
 * judge a purchase by comparing two numbers in `e`-notation. `1.21e47` of gold
 * against a price of `5.92e50` is not a decision anyone can make in their head
 * - it is three and a half orders of magnitude, and whether that is ten
 * seconds or ten hours depends entirely on a rate the interface never showed.
 *
 * Returns null wherever an honest answer is not available: before the meter
 * has warmed up, while the run is earning nothing, and when the wait is long
 * enough that a number would be false precision. Callers show nothing rather
 * than something made up.
 */

/** Past this, "how long" stops being a useful question. */
const HORIZON_SECONDS = 60 * 60 * 24 * 7;

export interface Affordability {
  /** Already paid for. */
  now: boolean;
  /** Null when there is no honest answer; see the module comment. */
  seconds: number | null;
}

export function timeToAfford(
  cost: string,
  balance: string,
  ratePerSecond: string | null | undefined,
): Affordability {
  const price = big(cost);
  const held = big(balance);
  if (held.cmp(price) >= 0) return { now: true, seconds: 0 };
  if (ratePerSecond === null || ratePerSecond === undefined) return { now: false, seconds: null };

  const rate = big(ratePerSecond);
  if (rate.cmp(0) <= 0) return { now: false, seconds: null };

  const seconds = price.sub(held).div(rate).toNumber();
  if (!Number.isFinite(seconds) || seconds > HORIZON_SECONDS) return { now: false, seconds: null };
  return { now: false, seconds: Math.max(0, seconds) };
}

/**
 * A duration at a glance: two fields at most, and never a field that is zero
 * unless it is the only one. `3h 0m` reads as a rounding artefact; `3h` reads
 * as three hours.
 */
export function formatWait(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  if (total < 60) return `${total}s`;

  const minutes = Math.floor(total / 60);
  if (minutes < 60) {
    const rest = total % 60;
    return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
  }

  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest === 0 ? `${days}d` : `${days}d ${rest}h`;
}

/** The whole answer as one short phrase, or null when there isn't one. */
export function affordabilityLabel(
  cost: string,
  balance: string,
  ratePerSecond: string | null | undefined,
): string | null {
  const answer = timeToAfford(cost, balance, ratePerSecond);
  if (answer.now) return 'Affordable now';
  if (answer.seconds === null) return null;
  return `in ${formatWait(answer.seconds)}`;
}
