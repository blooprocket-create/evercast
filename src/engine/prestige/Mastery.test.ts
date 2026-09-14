import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE_CONFIG } from '../config';
import { CombatSystem } from '../combat/CombatSystem';
import { wizardPerHit } from '../companions/CompanionCombat';
import type { GameEvent } from '../events/GameEvent';
import { mageMaxHealth } from '../gear/GearSystem';
import { big } from '../numbers';
import { SpellTreeSystem } from '../spellTree/SpellTreeSystem';
import { createInitialGameState } from '../state';
import { NO_MASTERY, masteryFromKnowledge, masteryMultiplier, previewMastery } from './Mastery';

/**
 * Mastery is what a Rebirth is worth. It is read off lifetime Knowledge rather
 * than the spendable balance, and that distinction is the whole design: keyed to
 * the balance, buying Schism would cost the player damage, and the attunements
 * and the multiplier would be substitutes instead of complements.
 */
describe('Mastery', () => {
  it('is exactly one before any Rebirth', () => {
    const state = createInitialGameState(DEFAULT_ENGINE_CONFIG);
    expect(masteryMultiplier(state.meta).toString()).toBe('1');
    expect(masteryFromKnowledge(big(0)).toString()).toBe('1');
    expect(NO_MASTERY.toString()).toBe('1');
  });

  it('follows the published curve', () => {
    const published: [number, number][] = [
      [1, 1.41421],
      [4, 2.23607],
      [9, 3.16228],
      [27, 5.2915],
      [77, 8.83176],
    ];
    for (const [knowledge, expected] of published) {
      expect(masteryFromKnowledge(big(knowledge)).toNumber()).toBeCloseTo(expected, 4);
    }
  });

  it('never decreases, and never drops below one', () => {
    let previous = masteryFromKnowledge(big(0));
    for (const knowledge of [0, 1, 2, 5, 11, 27, 77, 200, 1000, 1e6]) {
      const value = masteryFromKnowledge(big(knowledge));
      expect(value.cmp(1)).toBeGreaterThanOrEqual(0);
      expect(value.cmp(previous)).toBeGreaterThanOrEqual(0);
      previous = value;
    }
    // A negative can only arrive from a corrupted save, and must not invert it.
    expect(masteryFromKnowledge(big(-50)).toString()).toBe('1');
  });

  it('memoizes without ever disagreeing with the curve', () => {
    for (const knowledge of [0, 3, 3, 99, 3]) {
      const meta = { lifetimeKnowledge: big(knowledge) };
      expect(masteryMultiplier(meta).toString()).toBe(masteryFromKnowledge(meta.lifetimeKnowledge).toString());
    }
  });

  it('previews what a cash-out would be worth without disturbing the current value', () => {
    const meta = { lifetimeKnowledge: big(9) };
    const now = masteryMultiplier(meta);
    expect(previewMastery(meta, big(18)).toString()).toBe(masteryFromKnowledge(big(27)).toString());
    expect(masteryMultiplier(meta).toString()).toBe(now.toString());
  });

  /**
   * The design's central claim, as a test that fails loudly if anyone ever keys
   * Mastery off the spendable balance. Spending Knowledge on an attunement must
   * cost the player nothing at all in power - otherwise the tree's own unlocks
   * become a trap, and the deeper you push the more punishing that trap gets.
   */
  it('does not fall when Knowledge is spent on an attunement', () => {
    const state = createInitialGameState(DEFAULT_ENGINE_CONFIG);
    state.meta.knowledge = big(10);
    state.meta.lifetimeKnowledge = big(10);
    const before = masteryMultiplier(state.meta).toString();

    const system = new SpellTreeSystem(() => {});
    expect(system.buyAttunement(state, 'second_route')).toBe(true);

    expect(state.meta.knowledge.toString()).toBe('4');
    expect(state.meta.lifetimeKnowledge.toString()).toBe('10');
    expect(masteryMultiplier(state.meta).toString()).toBe(before);
  });

  describe('what it multiplies', () => {
    function castDamage(mastery: ReturnType<typeof big>, mechanics: boolean): number {
      const state = createInitialGameState(DEFAULT_ENGINE_CONFIG);
      state.equipment.pieces.staff.level = 20;
      if (!mechanics) state.run.spell.mechanics = undefined;
      state.run.enemies = [
        {
          instanceId: 1,
          definitionId: 'target',
          name: 'target',
          stage: 1,
          boss: false,
          hp: big('1e12'),
          maxHp: big('1e12'),
          attackDamage: big(0),
          attackInterval: 1,
          attackCooldown: 1,
        },
      ];
      const events: GameEvent[] = [];
      new CombatSystem(DEFAULT_ENGINE_CONFIG, (event) => events.push(event)).cast(
        state.run,
        state.equipment,
        mastery,
      );
      const hit = events.find((event) => event.type === 'projectile_hit');
      return Number((hit as { damage: string }).damage);
    }

    // Once, not twice: the mechanics path multiplies by routeDamageScale as well,
    // and a Mastery folded into the wrong side of that would square quietly.
    it('scales a plain cast exactly once', () => {
      expect(castDamage(big(4), false) / castDamage(NO_MASTERY, false)).toBeCloseTo(4, 6);
    });

    it('scales a cast with mechanics exactly once', () => {
      expect(castDamage(big(4), true) / castDamage(NO_MASTERY, true)).toBeCloseTo(4, 6);
    });

    it('lifts companions, because their damage is a share of the mage', () => {
      const state = createInitialGameState(DEFAULT_ENGINE_CONFIG);
      state.equipment.pieces.staff.level = 20;
      const plain = wizardPerHit(state.run, state.equipment, NO_MASTERY);
      const mastered = wizardPerHit(state.run, state.equipment, big(4));
      expect(mastered.div(plain).toNumber()).toBeCloseTo(4, 6);
    });

    it('lifts the mage maximum, and the party health derived from it', () => {
      const state = createInitialGameState(DEFAULT_ENGINE_CONFIG);
      state.equipment.pieces.robe.level = 20;
      const plain = mageMaxHealth(state, DEFAULT_ENGINE_CONFIG.baseMageHealth);

      state.meta.lifetimeKnowledge = big(9);
      const mastered = mageMaxHealth(state, DEFAULT_ENGINE_CONFIG.baseMageHealth);

      // Both sides of the fight had failed, so it is not a damage-only reward:
      // deaths are the dominant pacing cost, each one dropping the run to farm.
      expect(mastered.div(plain).toNumber()).toBeCloseTo(masteryFromKnowledge(big(9)).toNumber(), 6);
    });
  });
});
