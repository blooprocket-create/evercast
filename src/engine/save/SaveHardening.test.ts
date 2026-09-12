import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE_CONFIG } from '../config';
import { EvercastSimulation } from '../EvercastSimulation';
import { isFiniteDecimal, parseSaveJson } from './SaveGuards';
import { COMPANION_BY_ID } from '../companions/CompanionCatalog';
import { SaveCodec, type SaveEnvelopeV8 } from './SaveCodec';
import { saveDigest, verifySaveDigest } from './SaveIntegrity';

/**
 * The security tests for the one untrusted input this game has.
 *
 * Every case here is a save blob that no amount of playing could produce,
 * handed to the codec to see what comes out. The property under test is always
 * the same one: whatever goes in, what comes out is a state the simulation can
 * run, draw and save again. Not "the cheat was refused" - a single-player game
 * with no server cannot promise that, and `SaveIntegrity.ts` says so plainly -
 * but "the game still works, and nothing impossible got in".
 */

const codec = new SaveCodec(DEFAULT_ENGINE_CONFIG);

/** A real save, from a real run, as the starting point for each attack. */
function realSave(): SaveEnvelopeV8 {
  const sim = new EvercastSimulation();
  sim.advance(120, { presentationEvents: false });
  return codec.encode(sim.getState(), new Date('2026-01-01T00:00:00Z'));
}

/** Round-trips through JSON so the decoder sees what a file would give it. */
function decode(envelope: unknown) {
  return codec.decode(JSON.parse(JSON.stringify(envelope)));
}

/** Proves the decoded state can actually be run and drawn, not merely built. */
function playable(state: ReturnType<typeof decode>['state']) {
  const sim = new EvercastSimulation({ initialState: state });
  sim.advance(5, { presentationEvents: false });
  return sim.getSnapshot();
}

describe('a save cannot poison the number system', () => {
  // `new Decimal('NaN')` succeeds and every later `.add()` returns NaN, so one
  // edited character used to be a permanently broken economy.
  for (const poison of ['NaN', 'Infinity', '-Infinity']) {
    it(`refuses ${poison} in a wallet and keeps the game running`, () => {
      const save = realSave();
      save.state.equipment.gold = poison;
      save.state.meta.knowledge = poison;
      save.state.run.essence = poison;
      save.state.companions.starlight = poison;

      const { state } = decode(save);
      expect(isFiniteDecimal(state.equipment.gold)).toBe(true);
      expect(isFiniteDecimal(state.meta.knowledge)).toBe(true);
      expect(isFiniteDecimal(state.run.essence)).toBe(true);
      expect(isFiniteDecimal(state.companions.starlight)).toBe(true);
      expect(playable(state).gold.display).not.toContain('NaN');
    });
  }

  it('refuses a negative wallet', () => {
    const save = realSave();
    save.state.equipment.gold = '-9999';
    expect(decode(save).state.equipment.gold.cmp(0)).toBe(0);
  });

  it('refuses a non-finite number where the loop reads one', () => {
    const save = realSave();
    // An infinite cooldown is an enemy that never swings; a NaN one is a
    // comparison that is false forever, which is the same thing wearing a hat.
    save.state.run.castCooldown = Number.POSITIVE_INFINITY as unknown as number;
    save.state.run.elapsedSeconds = Number.NaN as unknown as number;
    const { state } = decode(save);
    expect(Number.isFinite(state.run.castCooldown)).toBe(true);
    expect(Number.isFinite(state.run.elapsedSeconds)).toBe(true);
  });
});

describe('a save cannot name things the game does not have', () => {
  it('drops an enemy whose definition the catalog never knew', () => {
    const save = realSave();
    save.state.run.enemies = [
      { ...save.state.run.enemies[0], definitionId: 'dragon_of_infinite_gold', instanceId: 9001 },
    ] as typeof save.state.run.enemies;

    // `requireEnemy` throws on an unknown id while the snapshot is being built,
    // which happens on the way to the first frame: this used to be a blank page
    // on every reload until storage was cleared by hand.
    const { state } = decode(save);
    expect(state.run.enemies).toHaveLength(0);
    expect(() => playable(state)).not.toThrow();
  });

  it('drops a companion the roster never had a definition for', () => {
    const save = realSave();
    save.state.companions.owned = {
      ...save.state.companions.owned,
      ghost_of_free_power: { definitionId: 'ghost_of_free_power', stars: 5, shards: 0 },
    } as typeof save.state.companions.owned;

    const { state } = decode(save);
    expect(state.companions.owned.ghost_of_free_power).toBeUndefined();
    expect(() => playable(state)).not.toThrow();
  });

  /**
   * The two companion lists answer to opposite rules, so one filter would be
   * wrong for one of them: fielded means "holds a party slot", benched means
   * "owned, and deliberately does not". Benched combatants are where a knockout
   * is remembered, so dropping them would let a player heal a downed companion
   * by taking it out of the party and putting it back.
   */
  it('fields only companions the party deployed, without discarding benched ones', () => {
    const save = realSave();
    const [first, second] = [...COMPANION_BY_ID.keys()];
    const combatant = (definitionId: string, slot: number) => ({
      slot,
      definitionId,
      stars: 5,
      hp: '10',
      maxHp: '10',
      attackCooldown: 0,
      abilityCooldown: 0,
      downed: true,
    });

    save.state.companions.owned = {
      [first]: { definitionId: first, stars: 2, shards: 0 },
      [second]: { definitionId: second, stars: 1, shards: 0 },
    };
    save.state.companions.party = [first, null, null, null, null];
    // `second` is not in the party, so it may only be benched; `first` is.
    save.state.run.companions = [
      combatant(first, 0),
      combatant(second, 1),
    ] as unknown as typeof save.state.run.companions;
    save.state.run.benchedCompanions = [
      combatant(second, 1),
    ] as unknown as typeof save.state.run.benchedCompanions;

    const { state } = decode(save);
    expect(state.run.companions.map((c) => c.definitionId)).toEqual([first]);
    expect(state.run.benchedCompanions.map((c) => c.definitionId)).toEqual([second]);
    // A knockout is remembered rather than healed by the round trip.
    expect(state.run.benchedCompanions[0].downed).toBe(true);
    // Stars come from the roster, not from the combatant's own claim of five.
    expect(state.run.companions[0].stars).toBe(2);
  });

  it('keeps only zone names the content catalog authored', () => {
    const save = realSave();
    save.state.run.zoneName = '<script>alert(1)</script>';
    expect(decode(save).state.run.zoneName).toBe('Greenfields');
  });
});

describe('a save cannot describe an impossible state', () => {
  it('clamps health above maximum', () => {
    const save = realSave();
    save.state.run.mage = { hp: '1e100', maxHp: '25' };
    const { state } = decode(save);
    expect(state.run.mage.hp.cmp(state.run.mage.maxHp)).toBeLessThanOrEqual(0);
  });

  it('raises the lifetime record to cover the run it is loading', () => {
    const save = realSave();
    save.state.meta.highestStageEver = 1;
    save.state.run.frontierStage = 400;
    expect(decode(save).state.meta.highestStageEver).toBeGreaterThanOrEqual(400);
  });

  it('refuses a gear level below one', () => {
    const save = realSave();
    save.state.equipment.pieces.staff = { slot: 'staff', level: -50, treeNodes: [] };
    expect(decode(save).state.equipment.pieces.staff.level).toBe(1);
  });
});

describe('a save cannot exhaust the machine it loads on', () => {
  it('bounds an absurd enemy count', () => {
    const save = realSave();
    const enemy = codec.encode(new EvercastSimulation().getState()).state.run.enemies[0];
    save.state.run.enemies = Array.from({ length: 50_000 }, (_, index) => ({
      ...(enemy ?? { definitionId: 'moss_slime' }),
      instanceId: index + 1,
    })) as typeof save.state.run.enemies;

    const { state } = decode(save);
    expect(state.run.enemies.length).toBeLessThanOrEqual(64);
  });

  it('bounds an absurd story-flag list', () => {
    const save = realSave();
    save.state.meta.storyFlags = Array.from({ length: 100_000 }, (_, i) => `flag_${i}`);
    expect(decode(save).state.meta.storyFlags.length).toBeLessThanOrEqual(256);
  });

  it('refuses a file too large to be a save', () => {
    expect(() => parseSaveJson(`"${'x'.repeat(5_000_000)}"`)).toThrow(/too large/);
  });
});

describe('parsing a save', () => {
  it('strips keys that ride along into every later spread', () => {
    const parsed = parseSaveJson('{"version":8,"__proto__":{"polluted":true},"state":{}}') as Record<
      string,
      unknown
    >;
    expect(Object.keys(parsed)).not.toContain('__proto__');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('refuses a blob that is not an object', () => {
    expect(decode('not a save').state.meta.rebirths).toBe(0);
    expect(decode([1, 2, 3]).state.meta.rebirths).toBe(0);
  });
});

describe('the integrity digest', () => {
  it('matches a save the codec wrote', () => {
    const save = realSave();
    expect(decode(save).integrity).toBe('ok');
  });

  it('notices an edited wallet', () => {
    const save = realSave();
    save.state.equipment.gold = '999999999999';
    expect(decode(save).integrity).toBe('mismatch');
  });

  it('notices a backdated stamp', () => {
    const save = realSave();
    save.savedAt = '1999-01-01T00:00:00.000Z';
    expect(decode(save).integrity).toBe('mismatch');
  });

  it('calls a save written before digests existed unverified, not edited', () => {
    const save = realSave();
    delete save.integrity;
    expect(decode(save).integrity).toBe('missing');
  });

  it('does not depend on key order', () => {
    const payload = { savedAt: 'a', state: { b: 1, a: [2, { d: 4, c: 3 }] } };
    const reordered = { state: { a: [2, { c: 3, d: 4 }], b: 1 }, savedAt: 'a' };
    expect(saveDigest(payload)).toBe(saveDigest(reordered));
  });

  it('changes when any byte of the state does', () => {
    const digests = new Set(
      [0, 1, 2, 3].map((n) => saveDigest({ savedAt: 'a', state: { gold: `${n}` } })),
    );
    expect(digests.size).toBe(4);
    expect(verifySaveDigest({ savedAt: 'a' }, 'not-a-digest')).toBe('mismatch');
  });

  /**
   * The load path deliberately does not throw on a mismatch. Refusing here
   * would cost a player their run for a `setItem` the browser was killed
   * half-way through, and would buy nothing: the validation above is what makes
   * the state safe, and it has already run.
   */
  it('still returns a usable state for a save that failed it', () => {
    const save = realSave();
    save.state.equipment.gold = '12345';
    const { state, integrity } = decode(save);
    expect(integrity).toBe('mismatch');
    expect(() => playable(state)).not.toThrow();
  });
});
