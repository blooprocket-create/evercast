import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE_CONFIG } from '../config';
import { createInitialGameState } from '../state';
import { evolutionTierForLevel, nextEvolutionLevel } from './GearCatalog';
import { GearSystem, compileGearStats, gearLevelCost } from './GearSystem';

describe('GearSystem', () => {
  it('starts standard gear with zero paid-level bonuses', () => {
    const state = createInitialGameState(DEFAULT_ENGINE_CONFIG);
    const stats = compileGearStats(state.equipment);
    expect(stats.baseDamageBonus.toNumber()).toBe(0);
    expect(stats.maxHpBonus.toNumber()).toBe(0);
  });

  it('adds flat stats per paid gear level instead of multipliers', () => {
    const state = createInitialGameState(DEFAULT_ENGINE_CONFIG);
    state.equipment.pieces.staff.level = 10;
    state.equipment.pieces.robe.level = 10;
    const stats = compileGearStats(state.equipment);
    expect(stats.baseDamageBonus.toNumber()).toBe(9);
    expect(stats.maxHpBonus.toNumber()).toBe(18);
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
