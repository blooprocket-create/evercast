import type { CompanionClass, CompanionRarity, FormationRow } from '../engine/companions/types';

/**
 * PLAYTEST defaults, not final balance. Centralized here for the same reason
 * `spellTreeTuning.ts` is: these are the numbers that will be moved a hundred
 * times, and none of them should be hiding inside a system file.
 *
 * Companion power is expressed as a FRACTION of the mage's own numbers rather
 * than as absolute values. Enemy health grows exponentially, so a companion
 * with an authored damage figure would fall off a cliff within an hour; a
 * companion worth "35% of a cast" is worth that at stage 10 and stage 10,000.
 */

/** Multiplier on every stat, by rarity. */
export const RARITY_POWER: Readonly<Record<CompanionRarity, number>> = {
  common: 1,
  rare: 1.45,
  epic: 2.1,
  legendary: 3.0,
  mythical: 4.3,
};

/** Multiplier on every stat, by star level. Index 0 is 1 star. */
export const STAR_POWER: readonly number[] = [1, 1.3, 1.7, 2.2, 2.9];

export interface ClassProfile {
  row: FormationRow;
  /** Share of the mage's max HP a 1-star common of this class has. */
  hpShare: number;
  /** Share of the wizard's per-hit damage this class deals per swing. */
  dpsShare: number;
  /** How hard enemies want to hit this class. The mage's threat is 1. */
  threat: number;
}

export const CLASS_PROFILES: Readonly<Record<CompanionClass, ClassProfile>> = {
  vanguard: { row: 'front', hpShare: 0.9, dpsShare: 0.1, threat: 8 },
  bruiser: { row: 'front', hpShare: 0.55, dpsShare: 0.28, threat: 4 },
  trickster: { row: 'flank', hpShare: 0.3, dpsShare: 0.32, threat: 2 },
  ranger: { row: 'flank', hpShare: 0.28, dpsShare: 0.35, threat: 1.5 },
  arcanist: { row: 'back', hpShare: 0.22, dpsShare: 0.4, threat: 1.2 },
  support: { row: 'back', hpShare: 0.32, dpsShare: 0.12, threat: 0.6 },
};

/** Each star adds this much threat, so a starred tank holds the line harder. */
export const THREAT_PER_STAR = 0.15;

/* ---------------------------------------------------------------- gacha --- */

export const SUMMON_COST = 80;
/** Ten pulls for the price of nine, the near-universal convention. */
export const SUMMON_COST_TEN = SUMMON_COST * 9;

/** Base draw weights. Must sum to 1. */
export const BASE_RATES: Readonly<Record<CompanionRarity, number>> = {
  common: 0.59,
  rare: 0.28,
  epic: 0.1,
  legendary: 0.025,
  mythical: 0.005,
};

/**
 * Pity, shaped after the Genshin/HSR ramp at idle-game scale. The advertised
 * 3% legendary-or-better is not the experienced rate: almost everything comes
 * out of the ramp, which is what makes a drought survivable rather than just
 * unlucky.
 */
/** Draws into a drought before the odds start climbing. */
export const PITY_SOFT_START = 60;
export const PITY_HARD = 80;
export const PITY_RAMP_PER_DRAW = 0.045;
/** Of every legendary-or-better, this share is mythical. */
export const MYTHICAL_SHARE = BASE_RATES.mythical / (BASE_RATES.legendary + BASE_RATES.mythical);
/** A ten-pull never comes back with nothing: the last roll floors here. */
export const TEN_PULL_FLOOR: CompanionRarity = 'epic';

/**
 * A duplicate is worth one shard, whatever it was.
 *
 * The difficulty of ascending a rarity belongs in what it costs, not in what
 * it pays: a mythical duplicate arriving at 0.5% was worth fifty shards AND
 * needed the same 20 to spend them on, which made the rare thing the easy one.
 * Rarity now moves the price instead, downward, so the companions that are
 * hardest to see again need the fewest sightings.
 */
export const SHARDS_PER_DUPLICATE = 1;

/** Shards for one star, by rarity. Flat across all four ascensions. */
export const STAR_UP_SHARDS: Readonly<Record<CompanionRarity, number>> = {
  common: 20,
  rare: 18,
  epic: 15,
  legendary: 13,
  mythical: 10,
};

/** Starlight refunded for a duplicate of an already-maxed companion. */
export const MAXED_DUPLICATE_REFUND: Readonly<Record<CompanionRarity, number>> = {
  common: 40,
  rare: 90,
  epic: 220,
  legendary: 600,
  mythical: 1500,
};

/* ------------------------------------------------------------- currency --- */

/**
 * Starlight per kill. Flat, and deliberately so.
 *
 * It used to scale with the square root of the stage, which meant the price of
 * a draw fell the further you pushed and the cost of a summon quietly stopped
 * meaning anything. A kill is a kill; only a boss is worth more.
 */
export const STARLIGHT_PER_KILL = 1;
export const STARLIGHT_PER_BOSS_KILL = 5;
