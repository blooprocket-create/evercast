import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE_CONFIG } from '../config';
import { EvercastSimulation } from '../EvercastSimulation';
import { SaveCodec } from '../save/SaveCodec';
import { big } from '../numbers';
import { createInitialGameState } from '../state';
// prettier-ignore
import { COMPANIONS, COMPANIONS_BY_RARITY, companionMaxHp, companionThreat, powerMultiplier, requireCompanion, validateCompanions } from './CompanionCatalog';
import { CompanionSystem, createInitialCompanionsState, restoreCompanions, starUpCost } from './CompanionSystem';
import { companionIndices, formationPosition, hasLivingFrontline, partyThresholds } from './Formation';
import { MAX_COMPANION_STARS, PARTY_SIZE } from './types';
import type { GameState } from '../model';

function stateWith(...definitionIds: string[]): GameState {
  const state = createInitialGameState(DEFAULT_ENGINE_CONFIG);
  for (const id of definitionIds) {
    state.companions.owned[id] = { definitionId: id, stars: 1, shards: 0 };
  }
  definitionIds.forEach((id, slot) => {
    if (slot < PARTY_SIZE) state.companions.party[slot] = id;
  });
  new CompanionSystem(() => {}).sync(state);
  return state;
}

describe('companion catalog', () => {
  it('authors content the engine can actually resolve', () => {
    expect(validateCompanions()).toEqual([]);
  });

  it('fills every rarity so no slice of the draw table is unreachable', () => {
    expect(COMPANIONS).toHaveLength(30);
    expect(COMPANIONS_BY_RARITY.get('common')).toHaveLength(10);
    expect(COMPANIONS_BY_RARITY.get('rare')).toHaveLength(8);
    expect(COMPANIONS_BY_RARITY.get('epic')).toHaveLength(6);
    expect(COMPANIONS_BY_RARITY.get('legendary')).toHaveLength(4);
    expect(COMPANIONS_BY_RARITY.get('mythical')).toHaveLength(2);
  });

  it('never authors two companions under one id', () => {
    expect(new Set(COMPANIONS.map((c) => c.id)).size).toBe(COMPANIONS.length);
  });

  it('makes rarity and stars both worth having', () => {
    const common = requireCompanion('hedge_warden');
    const legendary = requireCompanion('sunless_knight');
    expect(powerMultiplier(legendary, 1)).toBeGreaterThan(powerMultiplier(common, 1));
    expect(powerMultiplier(common, 5)).toBeGreaterThan(powerMultiplier(common, 1));
    // Stars are clamped, so a corrupt save cannot mint unbounded power.
    expect(powerMultiplier(common, 99)).toBe(powerMultiplier(common, MAX_COMPANION_STARS));
    expect(powerMultiplier(common, -3)).toBe(powerMultiplier(common, 1));
  });

  it('scales health off the mage rather than an authored figure', () => {
    const definition = requireCompanion('cairn_tortoise');
    const small = companionMaxHp(definition, 1, big(100));
    const large = companionMaxHp(definition, 1, big(1e30));
    // The whole point: a companion is worth the same share at every magnitude.
    expect(large.div(small).toNumber()).toBeCloseTo(1e28, 0);
  });

  it('gives tanks more threat than healers, and stars more than none', () => {
    const vanguard = requireCompanion('hedge_warden');
    const support = requireCompanion('hearth_candle');
    expect(companionThreat(vanguard, 1)).toBeGreaterThan(companionThreat(support, 1));
    expect(companionThreat(vanguard, 5)).toBeGreaterThan(companionThreat(vanguard, 1));
  });
});

describe('formation', () => {
  it('keeps the front row in front of the mage and the back row behind', () => {
    expect(formationPosition('front', 0).x).toBeGreaterThan(0);
    expect(formationPosition('back', 0).x).toBeLessThan(0);
  });

  it('never puts two companions of a row in the same place', () => {
    const points = [0, 1, 2, 3, 4].map((index) => formationPosition('front', index));
    const keys = new Set(points.map((point) => `${point.x}:${point.z}`));
    expect(keys.size).toBe(points.length);
  });

  it('does not move anyone when a different slot is filled', () => {
    // Positions are a pure function of (row, index in row). If they shifted,
    // every companion's reach threshold would move with them - and those are
    // events the combat loop has to be able to stop on.
    const one = stateWith('hedge_warden');
    const two = stateWith('hedge_warden', 'cairn_tortoise');
    expect(companionIndices(one.run).get(0)).toBe(0);
    expect(companionIndices(two.run).get(0)).toBe(0);
  });

  it('reports a frontline only while something in front is standing', () => {
    const state = stateWith('hedge_warden', 'hearth_candle');
    expect(hasLivingFrontline(state.run)).toBe(true);
    const frontliner = state.run.companions.find((c) => c.definitionId === 'hedge_warden');
    if (frontliner) frontliner.downed = true;
    expect(hasLivingFrontline(state.run)).toBe(false);
  });

  it('offers a threshold for every living companion and none for the downed', () => {
    const state = stateWith('hedge_warden', 'sling_boy');
    expect(partyThresholds(state.run)).toHaveLength(2);
    const downed = state.run.companions[0];
    if (downed) downed.downed = true;
    expect(partyThresholds(state.run)).toHaveLength(1);
  });
});

describe('companion system', () => {
  it('builds live combatants from the party and nothing else', () => {
    const state = stateWith('hedge_warden', 'hearth_candle');
    expect(state.run.companions.map((c) => c.definitionId)).toEqual([
      'hedge_warden',
      'hearth_candle',
    ]);
    expect(state.run.companions.every((c) => c.hp.cmp(c.maxHp) === 0)).toBe(true);
  });

  it('ignores a party entry for something no longer owned', () => {
    const state = stateWith('hedge_warden');
    state.companions.party[1] = 'nobody_owns_this';
    new CompanionSystem(() => {}).sync(state);
    expect(state.run.companions).toHaveLength(1);
  });

  it('keeps a companion wounded when it keeps its slot', () => {
    const state = stateWith('hedge_warden');
    const system = new CompanionSystem(() => {});
    const companion = state.run.companions[0];
    if (!companion) throw new Error('expected a companion');
    companion.hp = companion.maxHp.div(2);

    // A resync because a ring was levelled must not heal the front line.
    state.run.mage.maxHp = state.run.mage.maxHp.mul(4);
    system.sync(state);
    const after = state.run.companions[0];
    if (!after) throw new Error('expected a companion');
    expect(after.hp.div(after.maxHp).toNumber()).toBeCloseTo(0.5, 6);
    expect(after.maxHp.cmp(companion.maxHp)).toBeGreaterThan(0);
  });

  it('brings the party back between encounters', () => {
    const state = stateWith('hedge_warden');
    const companion = state.run.companions[0];
    if (!companion) throw new Error('expected a companion');
    companion.hp = big(0);
    companion.downed = true;

    restoreCompanions(state.run);
    expect(companion.downed).toBe(false);
    expect(companion.hp.cmp(companion.maxHp)).toBe(0);
  });

  it('moves a companion rather than letting it hold two slots', () => {
    const state = stateWith('hedge_warden');
    const system = new CompanionSystem(() => {});
    expect(system.equip(state, 'hedge_warden', 3)).toBe(true);
    expect(state.companions.party.filter((id) => id === 'hedge_warden')).toHaveLength(1);
    expect(state.companions.party[3]).toBe('hedge_warden');
  });

  it('refuses to equip what is not owned, or into a slot that does not exist', () => {
    const state = stateWith('hedge_warden');
    const system = new CompanionSystem(() => {});
    expect(system.equip(state, 'sunless_knight', 1)).toBe(false);
    expect(system.equip(state, 'hedge_warden', PARTY_SIZE)).toBe(false);
    expect(system.equip(state, 'hedge_warden', -1)).toBe(false);
    expect(system.unequip(state, 4)).toBe(false);
  });

  it('spends shards to ascend and stops at five stars', () => {
    const state = stateWith('hedge_warden');
    const system = new CompanionSystem(() => {});
    const owned = state.companions.owned.hedge_warden;
    if (!owned) throw new Error('expected ownership');

    expect(system.ascend(state, 'hedge_warden')).toBe(false); // no shards yet

    for (let star = 1; star < MAX_COMPANION_STARS; star += 1) {
      const cost = starUpCost(owned.stars);
      if (cost === null) throw new Error('expected a cost');
      owned.shards = cost;
      expect(system.ascend(state, 'hedge_warden')).toBe(true);
      expect(owned.shards).toBe(0);
    }

    expect(owned.stars).toBe(MAX_COMPANION_STARS);
    expect(starUpCost(owned.stars)).toBeNull();
    owned.shards = 10_000;
    expect(system.ascend(state, 'hedge_warden')).toBe(false);
  });

  it('raises the power of a companion that ascends', () => {
    const state = stateWith('hedge_warden');
    const system = new CompanionSystem(() => {});
    const before = state.run.companions[0]?.maxHp;
    const owned = state.companions.owned.hedge_warden;
    if (!owned || !before) throw new Error('expected ownership');
    owned.shards = starUpCost(1) ?? 0;
    system.ascend(state, 'hedge_warden');
    expect(state.run.companions[0]?.maxHp.cmp(before)).toBe(1);
  });
});

describe('companion persistence', () => {
  it('round-trips the roster, the party and the pity count', () => {
    const codec = new SaveCodec(DEFAULT_ENGINE_CONFIG);
    const state = stateWith('sunless_knight', 'hearth_candle');
    state.companions.starlight = big('12345');
    state.companions.drawSerial = 77;
    state.companions.pityCounter = 41;
    const owned = state.companions.owned.sunless_knight;
    if (owned) {
      owned.stars = 3;
      owned.shards = 17;
    }

    const decoded = codec.decode(JSON.parse(JSON.stringify(codec.encode(state)))).state;
    expect(decoded.companions.starlight.toString()).toBe('12345');
    expect(decoded.companions.drawSerial).toBe(77);
    expect(decoded.companions.pityCounter).toBe(41);
    expect(decoded.companions.owned.sunless_knight).toEqual({
      definitionId: 'sunless_knight',
      stars: 3,
      shards: 17,
    });
    expect(decoded.companions.party.slice(0, 2)).toEqual(['sunless_knight', 'hearth_candle']);
    expect(decoded.run.companions).toHaveLength(2);
  });

  it('gives a version 6 save an empty roster rather than failing to load', () => {
    const codec = new SaveCodec(DEFAULT_ENGINE_CONFIG);
    const envelope = codec.encode(createInitialGameState(DEFAULT_ENGINE_CONFIG)) as unknown as Record<string, unknown>;
    const legacy = JSON.parse(JSON.stringify(envelope)) as {
      version: number;
      state: Record<string, unknown> & { run: Record<string, unknown> };
    };
    legacy.version = 6;
    delete legacy.state.companions;
    delete legacy.state.run.companions;

    const decoded = codec.decode(legacy).state;
    expect(decoded.companions).toEqual(createInitialCompanionsState());
    expect(decoded.run.companions).toEqual([]);
  });

  it('drops a party entry whose companion is no longer owned', () => {
    const codec = new SaveCodec(DEFAULT_ENGINE_CONFIG);
    const state = stateWith('hedge_warden');
    const envelope = JSON.parse(JSON.stringify(codec.encode(state))) as {
      state: { companions: { owned: Record<string, unknown>; party: (string | null)[] } };
    };
    envelope.state.companions.owned = {};

    const decoded = codec.decode(envelope).state;
    expect(decoded.companions.party.every((entry) => entry === null)).toBe(true);
  });

  it('survives a rebirth, which is what makes collecting worth anything', () => {
    const simulation = new EvercastSimulation({ config: { rebirthUnlockStage: 1 } });
    const state = simulation.getState();
    state.companions.owned.pale_herald = { definitionId: 'pale_herald', stars: 4, shards: 9 };
    state.companions.party[0] = 'pale_herald';
    state.companions.starlight = big(500);
    state.run.highestStageThisRun = 50;

    expect(simulation.execute({ type: 'rebirth' })).toBe(true);
    const after = simulation.getState();
    expect(after.companions.owned.pale_herald?.stars).toBe(4);
    expect(after.companions.starlight.toString()).toBe('500');
    expect(after.run.companions.map((c) => c.definitionId)).toEqual(['pale_herald']);
  });
});
