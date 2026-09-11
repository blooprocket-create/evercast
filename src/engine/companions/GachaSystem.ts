import type { EngineConfig } from '../config';
// prettier-ignore
import { BASE_RATES, DUPLICATE_SHARDS, MAXED_DUPLICATE_REFUND, MYTHICAL_SHARE, PITY_HARD, PITY_RAMP_PER_DRAW, PITY_SOFT_START, SUMMON_COST, SUMMON_COST_TEN, TEN_PULL_FLOOR } from '../../content/companionTuning';
import type { GameEvent } from '../events/GameEvent';
import type { GameState } from '../model';
import { big } from '../numbers';
import { chooseDeterministic, random01 } from '../random/DeterministicRandom';
import { COMPANIONS_BY_RARITY } from './CompanionCatalog';
import type { CompanionRarity } from './types';
import { COMPANION_RARITIES, MAX_COMPANION_STARS } from './types';

/**
 * Distinct salts so the three questions a draw asks - how rare, which of that
 * rarity, and legendary or mythical - never read the same bits of the hash.
 */
const RARITY_SALT = 0x5ac_1a1;
const PICK_SALT = 0xc0_ffee;
const MYTHICAL_SALT = 0x1f1c5a;

/** Rarities that count as a "win" and reset pity. */
const HIGH_RARITIES: readonly CompanionRarity[] = ['legendary', 'mythical'];
const BASE_HIGH_CHANCE = BASE_RATES.legendary + BASE_RATES.mythical;

export interface SummonResult {
  definitionId: string;
  rarity: CompanionRarity;
  duplicate: boolean;
  /** Shards banked by a duplicate; zero for a new companion. */
  shards: number;
  /** Starlight handed back for a duplicate of an already-maxed companion. */
  refund: number;
  /** Star level after the draw. New companions arrive at one star. */
  stars: number;
}

export function summonCost(count: number): number {
  return count === 10 ? SUMMON_COST_TEN : SUMMON_COST * count;
}

/**
 * The chance this draw is legendary or better, given how long the drought has
 * run. `draw` is 1-based within the drought: the first draw after a win is 1.
 *
 * The published 3% is not the experienced rate and is not meant to be. Almost
 * every high-rarity pull comes out of the ramp, which is the whole reason a
 * long drought reads as building tension rather than as being cheated.
 */
export function highRarityChance(draw: number): number {
  if (draw >= PITY_HARD) return 1;
  if (draw <= PITY_SOFT_START) return BASE_HIGH_CHANCE;
  return Math.min(1, BASE_HIGH_CHANCE + (draw - PITY_SOFT_START) * PITY_RAMP_PER_DRAW);
}

/**
 * One rarity roll.
 *
 * The low tiers keep their base proportions to one another while the high
 * tiers grow, so soft pity eats into common/rare/epic evenly instead of
 * quietly deleting one of them.
 */
export function rollRarity(seed: number, serial: number, draw: number): CompanionRarity {
  const high = highRarityChance(draw);
  const roll = random01(seed, serial, RARITY_SALT);

  if (roll < high) {
    return random01(seed, serial, MYTHICAL_SALT) < MYTHICAL_SHARE ? 'mythical' : 'legendary';
  }

  const remaining = 1 - high;
  if (remaining <= 0) return 'legendary';
  const lowTotal = BASE_RATES.common + BASE_RATES.rare + BASE_RATES.epic;
  const scaled = ((roll - high) / remaining) * lowTotal;
  if (scaled < BASE_RATES.common) return 'common';
  if (scaled < BASE_RATES.common + BASE_RATES.rare) return 'rare';
  return 'epic';
}

export function isHighRarity(rarity: CompanionRarity): boolean {
  return HIGH_RARITIES.includes(rarity);
}

/** Whether a rarity clears the ten-pull floor. */
function meetsFloor(rarity: CompanionRarity): boolean {
  return COMPANION_RARITIES.indexOf(rarity) >= COMPANION_RARITIES.indexOf(TEN_PULL_FLOOR);
}

export class GachaSystem {
  constructor(
    private readonly config: EngineConfig,
    private readonly emit: (event: GameEvent) => void,
  ) {}

  canAfford(state: GameState, count: number): boolean {
    return state.companions.starlight.cmp(big(summonCost(count))) >= 0;
  }

  /**
   * Draws `count` companions, or returns null if they cannot be paid for.
   *
   * `drawSerial` is what makes a roll unique and replayable: the random source
   * is a pure hash with no stored stream, so draw N is the same roll whether it
   * happens now, after a reload, or inside a test.
   */
  draw(state: GameState, count: number): SummonResult[] | null {
    if (!Number.isInteger(count) || count < 1 || count > 10) return null;
    const cost = big(summonCost(count));
    const companions = state.companions;
    if (companions.starlight.cmp(cost) < 0) return null;
    companions.starlight = companions.starlight.sub(cost);

    // Rarities first, so the ten-pull floor can be applied before anything is
    // granted. A floor only fires when nothing reached epic, which means no
    // legendary either - so it can never disturb the pity count above it.
    const serials: number[] = [];
    const rarities: CompanionRarity[] = [];
    for (let index = 0; index < count; index += 1) {
      const serial = companions.drawSerial + index;
      const rarity = rollRarity(this.config.seed, serial, companions.pityCounter + 1);
      serials.push(serial);
      rarities.push(rarity);
      companions.pityCounter = isHighRarity(rarity) ? 0 : companions.pityCounter + 1;
    }
    if (count === 10 && !rarities.some(meetsFloor)) rarities[count - 1] = TEN_PULL_FLOOR;

    companions.drawSerial += count;

    const results: SummonResult[] = [];
    for (let index = 0; index < count; index += 1) {
      results.push(this.grant(state, serials[index] ?? 0, rarities[index] ?? 'common'));
    }
    return results;
  }

  private grant(state: GameState, serial: number, rarity: CompanionRarity): SummonResult {
    const companions = state.companions;
    const pool = COMPANIONS_BY_RARITY.get(rarity) ?? [];
    const definition = chooseDeterministic(pool, this.config.seed, serial, PICK_SALT);
    const existing = companions.owned[definition.id];

    let duplicate = false;
    let shards = 0;
    let refund = 0;
    let stars = 1;

    if (!existing) {
      companions.owned[definition.id] = { definitionId: definition.id, stars: 1, shards: 0 };
    } else {
      duplicate = true;
      stars = existing.stars;
      if (existing.stars >= MAX_COMPANION_STARS) {
        // Nothing left to ascend into, so the pull pays for the next one
        // instead of banking shards that could never be spent.
        refund = MAXED_DUPLICATE_REFUND[rarity];
        companions.starlight = companions.starlight.add(big(refund));
      } else {
        shards = DUPLICATE_SHARDS[rarity];
        existing.shards += shards;
      }
    }

    this.emit({
      type: 'companion_summoned',
      time: state.run.elapsedSeconds,
      definitionId: definition.id,
      rarity,
      duplicate,
      shards,
      stars,
    });

    return { definitionId: definition.id, rarity, duplicate, shards, refund, stars };
  }
}
