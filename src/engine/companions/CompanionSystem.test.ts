import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE_CONFIG } from '../config';
import { EvercastSimulation } from '../EvercastSimulation';
import { SaveCodec } from '../save/SaveCodec';
import { big } from '../numbers';
import { createInitialGameState } from '../state';
// prettier-ignore
import { COMPANIONS, COMPANIONS_BY_RARITY, companionMaxHp, companionThreat, powerMultiplier, requireCompanion, validateCompanions } from './CompanionCatalog';
import { CompanionSystem, createInitialCompanionsState, restoreCompanions, starUpCost } from './CompanionSystem';
// prettier-ignore
import { companionIndices, formationPosition, hasLivingFrontline, partyThresholds, reachThreshold } from './Formation';
import { CONTACT_SLOTS } from '../combat/Contact';
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

  it('keeps the front rank clear of where the wave comes to rest', () => {
    /*
     * The two numbers that make room for a front row are tuned against each
     * other: move the standoff or a front slot without the other and the wave
     * either stands inside the tanks or stops off in the distance. Bodies are
     * about 0.3 in radius, so 0.6 is touching.
     */
    const { enemyAttackRange, frontlineStandoff } = DEFAULT_ENGINE_CONFIG;
    const nearestEnemyRest = enemyAttackRange + frontlineStandoff + Math.min(...CONTACT_SLOTS.map((s) => s.xPad));
    const furthestCompanion = Math.max(
      ...[0, 1, 2, 3, 4].map((index) => formationPosition('front', index).x),
    );
    expect(nearestEnemyRest - furthestCompanion).toBeGreaterThan(0.6);
  });

  it('puts every companion within reach of where the wave stops', () => {
    // A companion that cannot touch the contact arc from its own slot would
    // stand there for the whole fight with its cooldown never ticking.
    const { enemyAttackRange, frontlineStandoff } = DEFAULT_ENGINE_CONFIG;
    const furthestEnemyRest =
      enemyAttackRange + frontlineStandoff + Math.max(...CONTACT_SLOTS.map((s) => s.xPad));
    for (const companion of COMPANIONS) {
      for (const index of [0, 1, 2, 3, 4]) {
        expect(
          reachThreshold(companion.id, index),
          `${companion.id} in row position ${index}`,
        ).toBeGreaterThan(furthestEnemyRest);
      }
    }
  });

  it('separates the party along the road, where the camera can see it', () => {
    // z is very nearly the depth axis at this camera angle, so a party laid
    // out across it draws as one clump on top of the mage.
    const xs = (['front', 'flank', 'back'] as const).map((row) => formationPosition(row, 0).x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(3);
    expect(formationPosition('front', 0).x).toBeGreaterThan(formationPosition('flank', 0).x);
    expect(formationPosition('flank', 0).x).toBeGreaterThan(formationPosition('back', 0).x);
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
      const cost = starUpCost('hedge_warden', owned.stars);
      if (cost === null) throw new Error('expected a cost');
      owned.shards = cost;
      expect(system.ascend(state, 'hedge_warden')).toBe(true);
      expect(owned.shards).toBe(0);
    }

    expect(owned.stars).toBe(MAX_COMPANION_STARS);
    expect(starUpCost('hedge_warden', owned.stars)).toBeNull();
    owned.shards = 10_000;
    expect(system.ascend(state, 'hedge_warden')).toBe(false);
  });

  it('raises the power of a companion that ascends', () => {
    const state = stateWith('hedge_warden');
    const system = new CompanionSystem(() => {});
    const before = state.run.companions[0]?.maxHp;
    const owned = state.companions.owned.hedge_warden;
    if (!owned || !before) throw new Error('expected ownership');
    owned.shards = starUpCost('hedge_warden', 1) ?? 0;
    system.ascend(state, 'hedge_warden');
    expect(state.run.companions[0]?.maxHp.cmp(before)).toBe(1);
  });
});

describe('party edits during a fight', () => {
  /*
   * A knockout costs the rest of the encounter. Every one of these was a way
   * to buy it back for free, because combat state was keyed by the slot a
   * companion happened to be holding rather than by the companion.
   */
  function downed(state: GameState, definitionId: string) {
    const companion =
      state.run.companions.find((entry) => entry.definitionId === definitionId) ??
      state.run.benchedCompanions.find((entry) => entry.definitionId === definitionId);
    if (!companion) throw new Error(`${definitionId} is neither fielded nor benched`);
    return companion;
  }

  it('does not revive a downed companion by moving it to another slot', () => {
    const state = stateWith('hedge_warden');
    const system = new CompanionSystem(() => {});
    const before = downed(state, 'hedge_warden');
    before.downed = true;
    before.hp = big(0);

    expect(system.equip(state, 'hedge_warden', 3)).toBe(true);
    const after = downed(state, 'hedge_warden');
    expect(after.slot).toBe(3);
    expect(after.downed).toBe(true);
    expect(after.hp.cmp(0)).toBe(0);
  });

  it('does not revive one by benching it and bringing it back', () => {
    const state = stateWith('hedge_warden');
    const system = new CompanionSystem(() => {});
    downed(state, 'hedge_warden').downed = true;
    downed(state, 'hedge_warden').hp = big(0);

    expect(system.unequip(state, 0)).toBe(true);
    expect(state.run.companions).toHaveLength(0);
    // Benched rather than discarded, which is the whole point.
    expect(state.run.benchedCompanions.map((c) => c.definitionId)).toEqual(['hedge_warden']);

    expect(system.equip(state, 'hedge_warden', 1)).toBe(true);
    const back = downed(state, 'hedge_warden');
    expect(back.downed).toBe(true);
    expect(back.hp.cmp(0)).toBe(0);
    expect(state.run.benchedCompanions).toHaveLength(0);
  });

  it('keeps a half-health companion half-healthy across a move', () => {
    const state = stateWith('hedge_warden');
    const system = new CompanionSystem(() => {});
    const wounded = downed(state, 'hedge_warden');
    wounded.hp = wounded.maxHp.div(4);

    system.equip(state, 'hedge_warden', 2);
    const after = downed(state, 'hedge_warden');
    expect(after.hp.div(after.maxHp).toNumber()).toBeCloseTo(0.25, 6);
  });

  it('empties the bench when the encounter ends', () => {
    const state = stateWith('hedge_warden');
    new CompanionSystem(() => {}).unequip(state, 0);
    expect(state.run.benchedCompanions).toHaveLength(1);
    restoreCompanions(state.run);
    expect(state.run.benchedCompanions).toEqual([]);
  });

  it('still starts a companion fresh if it never fought this encounter', () => {
    const state = stateWith('hedge_warden');
    state.companions.owned.sunless_knight = {
      definitionId: 'sunless_knight',
      stars: 1,
      shards: 0,
    };
    new CompanionSystem(() => {}).equip(state, 'sunless_knight', 1);
    const fresh = downed(state, 'sunless_knight');
    expect(fresh.downed).toBe(false);
    expect(fresh.hp.cmp(fresh.maxHp)).toBe(0);
  });
});

describe('shields', () => {
  it('does not carry an unspent bulwark into the next encounter', () => {
    const state = stateWith('hedge_warden');
    const companion = state.run.companions[0];
    if (!companion) throw new Error('expected a companion');
    companion.shield = big(500);
    restoreCompanions(state.run);
    expect(companion.shield).toBeUndefined();
  });

  it('survives a save as something combat can still subtract from', () => {
    // It reached JSON as a raw Decimal and came back a plain value, so the
    // next blow called .cmp on it and took the run down with it.
    const codec = new SaveCodec(DEFAULT_ENGINE_CONFIG);
    const state = stateWith('hedge_warden');
    const companion = state.run.companions[0];
    if (!companion) throw new Error('expected a companion');
    companion.shield = big('1234.5');

    const decoded = codec.decode(JSON.parse(JSON.stringify(codec.encode(state)))).state;
    const restored = decoded.run.companions[0];
    expect(restored?.shield?.toString()).toBe('1234.5');
    expect(() => restored?.shield?.cmp(1)).not.toThrow();
  });

  it('round-trips the bench, which also holds Decimals', () => {
    const codec = new SaveCodec(DEFAULT_ENGINE_CONFIG);
    const state = stateWith('hedge_warden');
    new CompanionSystem(() => {}).unequip(state, 0);
    const decoded = codec.decode(JSON.parse(JSON.stringify(codec.encode(state)))).state;
    const benched = decoded.run.benchedCompanions[0];
    expect(benched?.definitionId).toBe('hedge_warden');
    expect(() => benched?.hp.cmp(0)).not.toThrow();
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

  it('refuses an id the catalog does not know rather than failing to boot', () => {
    /*
     * importSaveFile persists the blob and then reloads, so an id accepted
     * here reaches requireCompanion on the next boot and throws - leaving the
     * game unstartable until storage is cleared by hand.
     */
    const codec = new SaveCodec(DEFAULT_ENGINE_CONFIG);
    const envelope = JSON.parse(JSON.stringify(codec.encode(stateWith('hedge_warden')))) as {
      state: { companions: { owned: Record<string, unknown>; party: (string | null)[] } };
    };
    envelope.state.companions.owned.not_a_real_companion = {
      definitionId: 'not_a_real_companion',
      stars: 4,
      shards: 9,
    };
    envelope.state.companions.party[1] = 'not_a_real_companion';

    const decoded = codec.decode(envelope).state;
    expect(decoded.companions.owned.not_a_real_companion).toBeUndefined();
    expect(decoded.companions.party).not.toContain('not_a_real_companion');
    expect(() => new EvercastSimulation({ initialState: decoded }).getSnapshot()).not.toThrow();
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
