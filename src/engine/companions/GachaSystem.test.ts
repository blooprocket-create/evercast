import { describe, expect, it } from 'vitest';
// prettier-ignore
import { BASE_RATES, MAXED_DUPLICATE_REFUND, SHARDS_PER_DUPLICATE, STAR_UP_SHARDS, PITY_HARD, PITY_SOFT_START, SUMMON_COST, SUMMON_COST_TEN } from '../../content/companionTuning';
import { DEFAULT_ENGINE_CONFIG } from '../config';
import { EvercastSimulation } from '../EvercastSimulation';
import type { GameState } from '../model';
import { big } from '../numbers';
import { SaveCodec } from '../save/SaveCodec';
import { createInitialGameState } from '../state';
import { requireCompanion } from './CompanionCatalog';
import { starUpCost } from './CompanionSystem';
import { starlightRewardForKill } from '../progression/StarlightEconomy';
// prettier-ignore
import { GachaSystem, highRarityChance, isHighRarity, rollRarity, summonCost } from './GachaSystem';
import { COMPANION_RARITIES, MAX_COMPANION_STARS } from './types';
import type { CompanionRarity } from './types';

const SEED = DEFAULT_ENGINE_CONFIG.seed;

function richState(starlight = 1e9): GameState {
  const state = createInitialGameState(DEFAULT_ENGINE_CONFIG);
  state.companions.starlight = big(starlight);
  return state;
}

describe('summon pricing', () => {
  it('gives a ten-pull the tenth draw free', () => {
    expect(summonCost(1)).toBe(SUMMON_COST);
    expect(summonCost(10)).toBe(SUMMON_COST_TEN);
    expect(summonCost(10)).toBeLessThan(SUMMON_COST * 10);
  });
});

describe('pity', () => {
  it('holds the base rate until the drought is long enough to matter', () => {
    const base = BASE_RATES.legendary + BASE_RATES.mythical;
    expect(highRarityChance(1)).toBeCloseTo(base, 10);
    expect(highRarityChance(PITY_SOFT_START)).toBeCloseTo(base, 10);
  });

  it('climbs once soft pity starts, and never falls back', () => {
    let previous = highRarityChance(PITY_SOFT_START);
    for (let draw = PITY_SOFT_START + 1; draw <= PITY_HARD; draw += 1) {
      const chance = highRarityChance(draw);
      expect(chance).toBeGreaterThanOrEqual(previous);
      previous = chance;
    }
  });

  it('guarantees a legendary at the hard cap', () => {
    expect(highRarityChance(PITY_HARD)).toBe(1);
    expect(rollRarity(SEED, 12_345, PITY_HARD)).toSatisfy(isHighRarity);
  });

  it('never lets a drought outlive the cap, whatever the seed', () => {
    // The promise the interface makes with its pity meter.
    for (let seed = 0; seed < 40; seed += 1) {
      const state = richState();
      const gacha = new GachaSystem({ ...DEFAULT_ENGINE_CONFIG, seed }, () => {});
      let longest = 0;
      let drought = 0;
      for (let draw = 0; draw < 400; draw += 1) {
        const results = gacha.draw(state, 1);
        if (!results?.[0]) throw new Error('expected a result');
        drought = isHighRarity(results[0].rarity) ? 0 : drought + 1;
        longest = Math.max(longest, drought);
      }
      expect(longest, `seed ${seed}`).toBeLessThan(PITY_HARD);
    }
  });
});

describe('draw rates', () => {
  it('lands near the published rates over a long run', () => {
    const counts = new Map<CompanionRarity, number>(
      COMPANION_RARITIES.map((rarity) => [rarity, 0]),
    );
    const samples = 120_000;
    for (let serial = 0; serial < samples; serial += 1) {
      // Pity fixed at one draw in, so this measures the base table alone.
      const rarity = rollRarity(SEED, serial, 1);
      counts.set(rarity, (counts.get(rarity) ?? 0) + 1);
    }
    for (const rarity of COMPANION_RARITIES) {
      const observed = (counts.get(rarity) ?? 0) / samples;
      // Generous tolerance: this guards a mis-wired table, not RNG quality.
      expect(observed, rarity).toBeGreaterThan(BASE_RATES[rarity] * 0.8);
      expect(observed, rarity).toBeLessThan(BASE_RATES[rarity] * 1.2 + 0.005);
    }
  });

  it('never returns a ten-pull with nothing epic or better in it', () => {
    for (let seed = 0; seed < 60; seed += 1) {
      const state = richState();
      const gacha = new GachaSystem({ ...DEFAULT_ENGINE_CONFIG, seed }, () => {});
      const results = gacha.draw(state, 10);
      if (!results) throw new Error('expected results');
      const best = Math.max(...results.map((r) => COMPANION_RARITIES.indexOf(r.rarity)));
      expect(best, `seed ${seed}`).toBeGreaterThanOrEqual(COMPANION_RARITIES.indexOf('epic'));
    }
  });
});

describe('drawing', () => {
  it('refuses a draw nobody can pay for, and charges for one they can', () => {
    const gacha = new GachaSystem(DEFAULT_ENGINE_CONFIG, () => {});
    const broke = createInitialGameState(DEFAULT_ENGINE_CONFIG);
    expect(gacha.draw(broke, 1)).toBeNull();
    expect(broke.companions.drawSerial).toBe(0);

    const state = richState(SUMMON_COST);
    expect(gacha.draw(state, 1)).toHaveLength(1);
    expect(state.companions.starlight.toString()).toBe('0');
  });

  it('rejects a count outside the buttons the interface offers', () => {
    const gacha = new GachaSystem(DEFAULT_ENGINE_CONFIG, () => {});
    const state = richState();
    expect(gacha.draw(state, 0)).toBeNull();
    expect(gacha.draw(state, 11)).toBeNull();
    expect(gacha.draw(state, 1.5)).toBeNull();
  });

  it('grants a new companion at one star and banks shards for a duplicate', () => {
    const gacha = new GachaSystem(DEFAULT_ENGINE_CONFIG, () => {});
    const state = richState();
    const seen = new Map<string, number>();

    for (let draw = 0; draw < 200; draw += 1) {
      const results = gacha.draw(state, 1);
      const result = results?.[0];
      if (!result) throw new Error('expected a result');
      const times = (seen.get(result.definitionId) ?? 0) + 1;
      seen.set(result.definitionId, times);

      if (times === 1) {
        expect(result.duplicate).toBe(false);
        expect(result.shards).toBe(0);
        expect(state.companions.owned[result.definitionId]?.stars).toBe(1);
      } else {
        expect(result.duplicate).toBe(true);
        expect(result.shards).toBe(SHARDS_PER_DUPLICATE);
      }
    }
  });

  it('pays starlight back rather than banking shards nobody could spend', () => {
    const gacha = new GachaSystem(DEFAULT_ENGINE_CONFIG, () => {});
    const state = richState();
    // Max out the first thing drawn, then keep drawing until it comes back.
    const first = gacha.draw(state, 1)?.[0];
    if (!first) throw new Error('expected a result');
    const owned = state.companions.owned[first.definitionId];
    if (!owned) throw new Error('expected ownership');
    owned.stars = MAX_COMPANION_STARS;

    let refunded = 0;
    for (let draw = 0; draw < 300 && refunded === 0; draw += 1) {
      const result = gacha.draw(state, 1)?.[0];
      if (result?.definitionId === first.definitionId) {
        expect(result.duplicate).toBe(true);
        expect(result.shards).toBe(0);
        expect(result.refund).toBe(MAXED_DUPLICATE_REFUND[result.rarity]);
        refunded = result.refund;
      }
    }
    expect(refunded).toBeGreaterThan(0);
  });

  it('names a companion that actually exists in the catalog', () => {
    const gacha = new GachaSystem(DEFAULT_ENGINE_CONFIG, () => {});
    const state = richState();
    const results = gacha.draw(state, 10);
    if (!results) throw new Error('expected results');
    for (const result of results) {
      expect(requireCompanion(result.definitionId).rarity).toBe(result.rarity);
    }
  });
});

describe('shard balance', () => {
  it('pays one shard for a duplicate, whatever it was', () => {
    const gacha = new GachaSystem(DEFAULT_ENGINE_CONFIG, () => {});
    const state = richState();
    const seen = new Set<string>();
    const rarities = new Set<CompanionRarity>();

    for (let draw = 0; draw < 400; draw += 1) {
      const result = gacha.draw(state, 1)?.[0];
      if (!result) throw new Error('expected a result');
      if (seen.has(result.definitionId)) {
        expect(result.shards, result.rarity).toBe(1);
        rarities.add(result.rarity);
      }
      seen.add(result.definitionId);
    }
    // Meaningless unless several rarities actually repeated.
    expect(rarities.size).toBeGreaterThan(1);
  });

  it('charges less per star the rarer a companion is', () => {
    /*
     * A mythical duplicate arrives at 0.5%. Paying it fifty shards and then
     * charging it the same price as a common made the rare thing the easy one;
     * the difficulty belongs in the price, and it runs downward.
     */
    const order: CompanionRarity[] = ['common', 'rare', 'epic', 'legendary', 'mythical'];
    const costs = order.map((rarity) => STAR_UP_SHARDS[rarity]);
    for (let index = 1; index < costs.length; index += 1) {
      expect(costs[index], order[index]).toBeLessThan(costs[index - 1] ?? 0);
    }
    expect(STAR_UP_SHARDS.common).toBe(20);
    expect(STAR_UP_SHARDS.mythical).toBe(10);
  });

  it('charges the same for every star, not more for the later ones', () => {
    const owned = { definitionId: 'hedge_warden', stars: 1, shards: 0 };
    const costs = [1, 2, 3, 4].map((stars) => starUpCost(owned.definitionId, stars));
    expect(new Set(costs).size).toBe(1);
    expect(starUpCost(owned.definitionId, 5)).toBeNull();
  });
});

describe('starlight balance', () => {
  it('pays the same for a kill wherever it happens', () => {
    // It used to grow with the square root of the stage, which meant a draw
    // cost less the further you pushed.
    for (const stage of [1, 10, 100, 10_000]) {
      expect(starlightRewardForKill(stage, false).toString(), `stage ${stage}`).toBe('1');
      expect(starlightRewardForKill(stage, true).toString(), `stage ${stage}`).toBe('5');
    }
  });

  it('pays nothing extra for a first clear', () => {
    const simulation = new EvercastSimulation({ config: { seed: 4 } });
    simulation.advance(400, { presentationEvents: false });
    const snapshot = simulation.getSnapshot();
    const kills = snapshot.kills;
    const starlight = Number(simulation.getState().companions.starlight.toString());
    // Every point of Starlight is a kill, and bosses are worth five.
    expect(starlight).toBeGreaterThanOrEqual(kills);
    expect(starlight).toBeLessThanOrEqual(kills * 5);
  });
});

describe('draw determinism', () => {
  it('gives the same serial the same result every time', () => {
    const first = new GachaSystem(DEFAULT_ENGINE_CONFIG, () => {}).draw(richState(), 10);
    const second = new GachaSystem(DEFAULT_ENGINE_CONFIG, () => {}).draw(richState(), 10);
    expect(first).toEqual(second);
  });

  it('resumes a save on the roll the session would have made next', () => {
    // The random source is a pure hash with no stored stream, so the serial is
    // the whole of the draw's identity - which is what lets a reload continue
    // rather than silently reroll.
    const codec = new SaveCodec(DEFAULT_ENGINE_CONFIG);
    const live = richState();
    const gacha = new GachaSystem(DEFAULT_ENGINE_CONFIG, () => {});
    gacha.draw(live, 10);

    const resumed = codec.decode(JSON.parse(JSON.stringify(codec.encode(live)))).state;
    const continued = gacha.draw(live, 1);
    const afterReload = new GachaSystem(DEFAULT_ENGINE_CONFIG, () => {}).draw(resumed, 1);
    expect(afterReload).toEqual(continued);
  });
});

describe('the summon command', () => {
  it('reports what was drawn so the reveal reads authoritative results', () => {
    const simulation = new EvercastSimulation();
    simulation.getState().companions.starlight = big(1e6);

    expect(simulation.execute({ type: 'summon_draw', count: 10 })).toBe(true);
    const snapshot = simulation.getSnapshot();
    expect(snapshot.lastSummon?.results).toHaveLength(10);
    expect(snapshot.lastSummon?.serial).toBe(10);
    for (const result of snapshot.lastSummon?.results ?? []) {
      expect(result.name).toBe(requireCompanion(result.definitionId).name);
    }
    expect(snapshot.companions.length).toBeGreaterThan(0);
  });

  it('leaves the serial alone when the draw is refused', () => {
    const simulation = new EvercastSimulation();
    expect(simulation.execute({ type: 'summon_draw', count: 10 })).toBe(false);
    expect(simulation.getSnapshot().lastSummon).toBeNull();
    expect(simulation.getState().companions.drawSerial).toBe(0);
  });

  it('earns starlight from kills so the collection loop feeds off combat', () => {
    const simulation = new EvercastSimulation();
    simulation.advance(120);
    expect(simulation.getState().companions.starlight.cmp(0)).toBe(1);
  });
});
