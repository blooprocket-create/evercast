import { big } from '../../engine/numbers';
import { affordabilityLabel } from '../format/timeToAfford';

export interface SpellPointOffer {
  /** Whether the point can be bought at all. */
  affordable: boolean;
  /** What the price costs in time, or null when there is nothing to say. */
  wait: string | null;
}

export interface SpellPointOfferInput {
  totalPoints: number;
  maxPoints: number;
  cost: string;
  essence: string;
  essencePerSecond: string | null | undefined;
}

/**
 * Whether a spell point can be bought, and what the wait is - as one answer.
 *
 * These were two derivations of one fact and they disagreed at the cap: the
 * button knew that a player holding every point cannot buy another, and the
 * label beside it knew only about essence, so it went on reading "Affordable
 * now" under a control that could not be pressed. Deriving both here is what
 * stops them drifting apart again.
 *
 * A capped tree has no wait rather than an infinite one, because the thing
 * being waited for is not essence and no amount of it will do.
 */
export function spellPointOffer({
  totalPoints,
  maxPoints,
  cost,
  essence,
  essencePerSecond,
}: SpellPointOfferInput): SpellPointOffer {
  if (totalPoints >= maxPoints) return { affordable: false, wait: null };
  return {
    affordable: big(essence).cmp(big(cost)) >= 0,
    wait: affordabilityLabel(cost, essence, essencePerSecond),
  };
}
