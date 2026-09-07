import { describe, expect, it } from 'vitest';
import { EvercastSimulation } from '../EvercastSimulation';
import { big } from '../numbers';
import { spellPointCost } from './SpellTreeCatalog';

describe('SpellTreeSystem', () => {
  it('starts with one free point and buys additional points with Arcane Essence', () => {
    const sim = new EvercastSimulation();
    expect(sim.getSnapshot().spellTreeTotalPoints).toBe(1);
    expect(sim.getSnapshot().spellTreeUnspentPoints).toBe(1);
    expect(spellPointCost(1)).toBeGreaterThan(spellPointCost(0));

    sim.getState().run.essence = big(100);
    const cost = Number(sim.getSnapshot().nextSpellPointCost.raw);
    expect(sim.execute({ type: 'buy_spell_point' })).toBe(true);
    expect(sim.getSnapshot().spellTreeTotalPoints).toBe(2);
    expect(Number(sim.getSnapshot().essence.raw)).toBe(100 - cost);
  });

  it('requires connected pathing and free respec returns spent points', () => {
    const sim = new EvercastSimulation();
    sim.getState().run.essence = big(10_000);
    for (let i = 0; i < 4; i += 1) expect(sim.execute({ type: 'buy_spell_point' })).toBe(true);

    expect(sim.execute({ type: 'activate_spell_node', nodeId: 'fire_splash' })).toBe(false);
    expect(sim.execute({ type: 'activate_spell_node', nodeId: 'power_1' })).toBe(true);
    expect(sim.execute({ type: 'activate_spell_node', nodeId: 'power_2' })).toBe(true);
    expect(sim.execute({ type: 'activate_spell_node', nodeId: 'power_notable' })).toBe(true);
    expect(sim.execute({ type: 'activate_spell_node', nodeId: 'fire_entry' })).toBe(true);
    expect(sim.execute({ type: 'activate_spell_node', nodeId: 'fire_splash' })).toBe(true);
    expect(sim.getSnapshot().splashTargets).toBe(2);

    expect(sim.execute({ type: 'respec_spell_tree' })).toBe(true);
    expect(sim.getSnapshot().activeSpellNodeIds).toEqual([]);
    expect(sim.getSnapshot().spellTreeUnspentPoints).toBe(5);
    expect(sim.getSnapshot().splashTargets).toBe(0);
  });

  it('lets a Storm path produce real chain targets', () => {
    const sim = new EvercastSimulation();
    sim.getState().run.essence = big(100_000);
    for (let i = 0; i < 6; i += 1) sim.execute({ type: 'buy_spell_point' });
    for (const nodeId of ['projectile_1', 'projectile_2', 'projectile_notable', 'storm_entry', 'storm_current', 'storm_chain']) {
      expect(sim.execute({ type: 'activate_spell_node', nodeId })).toBe(true);
    }
    const snapshot = sim.getSnapshot();
    expect(snapshot.projectileCount).toBe(4);
    expect(snapshot.chainTargets).toBe(2);
    expect(snapshot.chainDamageMultiplier).toBeCloseTo(0.45);
  });
});
