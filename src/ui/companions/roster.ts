import { big } from '../../engine/numbers';
import { COMPANION_RARITIES } from '../../engine/companions/types';
import type { CompanionSnapshot } from '../../engine/types';

/**
 * Sorting, filtering and searching a roster of thirty.
 *
 * The screen had none of the three. A gacha game's collection is the screen a
 * player spends the most time on outside the fight, and this one was a list in
 * whatever order the catalog happened to be in, with no way to answer "who can
 * I ascend", "who is actually deployed", or "where is the one I just pulled".
 *
 * Pure, and tested, because a comparator is exactly the kind of thing that
 * looks right and puts Mythical below Common.
 */

export const ROSTER_SORTS = ['rarity', 'name', 'stars', 'power'] as const;
export type RosterSort = (typeof ROSTER_SORTS)[number];

export const SORT_LABEL: Readonly<Record<RosterSort, string>> = {
  rarity: 'Rarity',
  name: 'Name',
  stars: 'Stars',
  power: 'Damage',
};

export const ROSTER_FILTERS = ['all', 'deployed', 'bench', 'ascendable'] as const;
export type RosterFilter = (typeof ROSTER_FILTERS)[number];

export const FILTER_LABEL: Readonly<Record<RosterFilter, string>> = {
  all: 'All',
  deployed: 'Deployed',
  bench: 'Bench',
  ascendable: 'Ready',
};

/** Rarity's own order, from the engine, so the two can never disagree. */
const RARITY_RANK = new Map(COMPANION_RARITIES.map((rarity, index) => [rarity, index]));

function byRarityThenStarsThenName(a: CompanionSnapshot, b: CompanionSnapshot): number {
  const rarity = (RARITY_RANK.get(b.rarity) ?? 0) - (RARITY_RANK.get(a.rarity) ?? 0);
  if (rarity !== 0) return rarity;
  if (b.stars !== a.stars) return b.stars - a.stars;
  return a.name.localeCompare(b.name);
}

const COMPARE: Readonly<Record<RosterSort, (a: CompanionSnapshot, b: CompanionSnapshot) => number>> = {
  rarity: byRarityThenStarsThenName,
  name: (a, b) => a.name.localeCompare(b.name),
  // Ties fall back to the default order rather than to insertion order, so a
  // roster of identical stars is still ranked by something the player can see.
  stars: (a, b) => (b.stars - a.stars) || byRarityThenStarsThenName(a, b),
  power: (a, b) => big(b.damage.raw).cmp(big(a.damage.raw)) || byRarityThenStarsThenName(a, b),
};

const MATCHES: Readonly<Record<RosterFilter, (companion: CompanionSnapshot) => boolean>> = {
  all: () => true,
  deployed: (companion) => companion.slot !== null,
  bench: (companion) => companion.slot === null,
  ascendable: (companion) => companion.canAscend,
};

export interface RosterView {
  sort: RosterSort;
  filter: RosterFilter;
  query: string;
}

/**
 * The roster as the player asked to see it. Never mutates the snapshot's own
 * array, which is shared with everything else reading it this frame.
 */
export function viewRoster(
  roster: readonly CompanionSnapshot[],
  { sort, filter, query }: RosterView,
): CompanionSnapshot[] {
  const needle = query.trim().toLowerCase();
  return roster
    .filter((companion) => MATCHES[filter](companion))
    .filter((companion) => needle === '' || companion.name.toLowerCase().includes(needle))
    .sort(COMPARE[sort]);
}

/** How many a filter would show, for the chip to say so before it is pressed. */
export function countFor(roster: readonly CompanionSnapshot[], filter: RosterFilter): number {
  return roster.reduce((total, companion) => total + (MATCHES[filter](companion) ? 1 : 0), 0);
}
