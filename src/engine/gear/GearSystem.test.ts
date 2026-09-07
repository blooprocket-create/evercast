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
