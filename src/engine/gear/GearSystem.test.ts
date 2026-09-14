import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE_CONFIG } from '../config';
import { createInitialGameState } from '../state';
import { GEAR_DEFINITIONS, GEAR_POWER_GROWTH, evolutionTierForLevel, nextEvolutionLevel } from './GearCatalog';
import { GearSystem, compileGearStats, gearDisplayData, gearLevelCost } from './GearSystem';

describe('GearSystem', () => {
  it('starts standard gear with zero paid-level bonuses', () => {
    const state = createInitialGameState(DEFAULT_ENGINE_CONFIG);
    const stats = compileGearStats(state.equipment);
    expect(stats.baseDamageBonus.toNumber()).toBe(0);
    expect(stats.maxHpBonus.toNumber()).toBe(0);
  });

  /**
   * These pin the curve's shape rather than a magic number at one level, because
   * the growth constant is expected to move during tuning and a value assertion
   * would only record whatever it was last set to.
   */
  it('keeps statPerLevel meaning exactly what it used to at the bottom of the curve', () => {
    const state = createInitialGameState(DEFAULT_ENGINE_CONFIG);
    state.equipment.pieces.staff.level = 2;
    state.equipment.pieces.robe.level = 2;
    const stats = compileGearStats(state.equipment);

    // One term of a geometric series is that term: the first paid level is
    // worth statPerLevel exactly, whatever the growth constant is.
    expect(stats.baseDamageBonus.toNumber()).toBe(GEAR_DEFINITIONS.staff.statPerLevel);
    expect(stats.maxHpBonus.toNumber()).toBe(GEAR_DEFINITIONS.robe.statPerLevel);
  });

  it('compounds each paid gear level instead of adding a flat amount', () => {
    const state = createInitialGameState(DEFAULT_ENGINE_CONFIG);
    state.equipment.pieces.staff.level = 10;
    const compounded = compileGearStats(state.equipment).baseDamageBonus;

    // Nine paid levels are worth strictly more than nine flat ones - that gap is
    // the whole change, and it is what lets the player keep up with enemy health.
    expect(compounded.toNumber()).toBeGreaterThan(9 * GEAR_DEFINITIONS.staff.statPerLevel);

    // ...and the marginal level grows by exactly the growth constant.
    state.equipment.pieces.staff.level = 11;
    const oneMore = compileGearStats(state.equipment).baseDamageBonus;
    state.equipment.pieces.staff.level = 9;
    const oneFewer = compileGearStats(state.equipment).baseDamageBonus;

    const thisLevel = oneMore.sub(compounded).toNumber();
    const lastLevel = compounded.sub(oneFewer).toNumber();
    expect(thisLevel / lastLevel).toBeCloseTo(GEAR_POWER_GROWTH, 10);
  });

  it('levels a gear piece with gold and applies the health delta', () => {
    const state = createInitialGameState(DEFAULT_ENGINE_CONFIG);
    state.equipment.gold = gearLevelCost('robe', 1);
    const events: unknown[] = [];
    const system = new GearSystem(DEFAULT_ENGINE_CONFIG, (event) => events.push(event));
    expect(system.levelUp(state, 'robe')).toBe(true);
    expect(state.equipment.pieces.robe.level).toBe(2);
    expect(state.run.mage.maxHp.toNumber()).toBe(DEFAULT_ENGINE_CONFIG.baseMageHealth + 2);
    expect(state.run.mage.hp.toNumber()).toBe(DEFAULT_ENGINE_CONFIG.baseMageHealth + 2);
    expect(events).toHaveLength(1);
  });

  /**
   * `compileGearStats` is memoized on the eight gear levels because it runs
   * several times per projectile per enemy. The memo is module-level shared
   * state, so these guard the two ways that can go wrong: a stale hit after the
   * levels move, and one equipment's stats leaking into another's.
   */
  describe('memoization', () => {
    it('invalidates when a level changes on the same equipment object', () => {
      const state = createInitialGameState(DEFAULT_ENGINE_CONFIG);
      const before = compileGearStats(state.equipment).baseDamageBonus.toString();

      // levelUp mutates the piece in place, so the object identity is unchanged.
      state.equipment.pieces.staff.level = 50;
      const after = compileGearStats(state.equipment).baseDamageBonus.toString();

      expect(after).not.toBe(before);
    });

    it('recomputes the same stats after another equipment has evicted the slot', () => {
      const first = createInitialGameState(DEFAULT_ENGINE_CONFIG);
      first.equipment.pieces.staff.level = 10;
      const other = createInitialGameState(DEFAULT_ENGINE_CONFIG);
      other.equipment.pieces.staff.level = 25;

      const cold = compileGearStats(first.equipment).baseDamageBonus.toString();
      const evicting = compileGearStats(other.equipment).baseDamageBonus.toString();
      const warm = compileGearStats(first.equipment).baseDamageBonus.toString();

      expect(warm).toBe(cold);
      expect(evicting).not.toBe(cold);
    });
  });

  /**
   * `gearDisplayData` used to compute the contribution longhand, and kept the
   * additive formula when the curve went geometric - so the screen reported a
   * level-100 staff as contributing 99 damage rather than 11,571, and derived a
   * next-level gain by subtracting one curve from the other. These pin the two
   * displayed values against the engine that actually pays them out, so a second
   * copy of the formula cannot drift from the first again.
   */
  describe('what the gear screen reports', () => {
    it('agrees with the stats combat actually uses', () => {
      for (const level of [1, 2, 10, 50, 100, 500]) {
        const state = createInitialGameState(DEFAULT_ENGINE_CONFIG);
        state.equipment.pieces.staff.level = level;
        const shown = gearDisplayData(state.equipment, 'staff').contribution;
        expect(shown.toString()).toBe(compileGearStats(state.equipment).baseDamageBonus.toString());
      }
    });

    it('reports the next level as what that one level actually adds', () => {
      for (const level of [1, 2, 10, 50, 100]) {
        const state = createInitialGameState(DEFAULT_ENGINE_CONFIG);
        state.equipment.pieces.staff.level = level;
        const before = compileGearStats(state.equipment).baseDamageBonus;
        const claimed = gearDisplayData(state.equipment, 'staff').nextLevelGain;

        state.equipment.pieces.staff.level = level + 1;
        const after = compileGearStats(state.equipment).baseDamageBonus;

        expect(claimed.toString()).toBe(after.sub(before).toString());
        // And it must stay a small fraction of the total, not approach it -
        // the symptom the old subtraction produced.
        if (level >= 10) expect(claimed.cmp(before)).toBeLessThan(0);
      }
    });
  });

  it('uses the agreed evolution milestone scaffold', () => {
    expect(evolutionTierForLevel(1)).toBe(0);
    expect(evolutionTierForLevel(49)).toBe(0);
    expect(evolutionTierForLevel(50)).toBe(1);
    expect(evolutionTierForLevel(100)).toBe(2);
    expect(evolutionTierForLevel(200)).toBe(3);
    expect(evolutionTierForLevel(500)).toBe(4);
    expect(evolutionTierForLevel(1000)).toBe(5);
    expect(nextEvolutionLevel(50)).toBe(100);
    expect(nextEvolutionLevel(1000)).toBeNull();
  });
});
