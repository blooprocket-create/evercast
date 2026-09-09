import { describe, expect, it } from 'vitest';
import { EvercastSimulation } from '../EvercastSimulation';
import { big } from '../numbers';
import { SPELL_TREE_NODES, SPELL_TREE_NODE_BY_ID, spellPointCost } from '../../content/spellTree';
import { MAX_SPELL_TREE_POINTS, spellNodeStatus } from './SpellTreeSystem';
function funded() {
  const sim = new EvercastSimulation();
  sim.getState().run.essence = big('1e20');
  for (let i = 0; i < 20; i++) expect(sim.execute({ type: 'buy_spell_point' })).toBe(true);
  return sim;
}
function awaken(sim: EvercastSimulation, id: string) {
  expect(sim.execute({ type: 'activate_spell_node', nodeId: id }), id).toBe(true);
}
describe('authored tree rules', () => {
  it('preserves the starter point and Essence purchasing economy', () => {
    const sim = new EvercastSimulation();
    expect(sim.getSnapshot().spellTreeTotalPoints).toBe(1);
    sim.getState().run.essence = big(100);
    expect(sim.execute({ type: 'buy_spell_point' })).toBe(true);
    expect(sim.getSnapshot().essence.raw).toBe(String(100 - spellPointCost(0)));
    expect(spellPointCost(1)).toBeGreaterThan(spellPointCost(0));
    sim.getState().run.essence = big('1e20');
    while (sim.getSnapshot().spellTreeTotalPoints < MAX_SPELL_TREE_POINTS)
      expect(sim.execute({ type: 'buy_spell_point' })).toBe(true);
    const before = sim.getSnapshot().essence.raw;
    expect(sim.execute({ type: 'buy_spell_point' })).toBe(false);
    expect(sim.getSnapshot().essence.raw).toBe(before);
  });
  for (const route of SPELL_TREE_NODES.filter((n) => n.kind === 'route')) {
    it(`${route.name} locks the other routes and respec restores them`, () => {
      const sim = funded();
      awaken(sim, route.id);
      for (const other of SPELL_TREE_NODES.filter((n) => n.kind === 'route' && n.id !== route.id)) {
        expect(spellNodeStatus(sim.getState().spellTree, other.id)).toBe('exclusive');
        expect(sim.execute({ type: 'activate_spell_node', nodeId: other.id })).toBe(false);
        const descendant = SPELL_TREE_NODES.find((n) => n.region === other.region && n.kind === 'mutation')!;
        expect(spellNodeStatus(sim.getState().spellTree, descendant.id)).toBe('exclusive');
      }
      const before = sim.getSnapshot().essence.raw;
      expect(sim.execute({ type: 'respec_spell_tree' })).toBe(true);
      expect(sim.getSnapshot().spellTreeUnspentPoints).toBe(21);
      expect(sim.getSnapshot().essence.raw).toBe(before);
      for (const other of SPELL_TREE_NODES.filter((n) => n.kind === 'route'))
        expect(spellNodeStatus(sim.getState().spellTree, other.id)).toBe('available');
    });
    it(`${route.name} permits every pair of identities and locks the third subtree`, () => {
      const identities = SPELL_TREE_NODES.filter((n) => n.region === route.region && n.kind === 'identity');
      for (let excluded = 0; excluded < 3; excluded++) {
        const sim = funded();
        awaken(sim, route.id);
        for (const identity of identities.filter((_, i) => i !== excluded)) awaken(sim, identity.id);
        expect(spellNodeStatus(sim.getState().spellTree, identities[excluded].id)).toBe('exclusive');
        const child = SPELL_TREE_NODES.find(
          (n) => n.kind === 'mutation' && n.requiresAll.includes(identities[excluded].id),
        )!;
        expect(spellNodeStatus(sim.getState().spellTree, child.id)).toBe('exclusive');
        sim.execute({ type: 'respec_spell_tree' });
        awaken(sim, route.id);
        awaken(sim, identities[excluded].id);
      }
    });
  }
  for (const fusion of SPELL_TREE_NODES.filter((n) => n.kind === 'fusion'))
    it(`${fusion.name} requires BOTH mutations`, () => {
      expect(fusion.requiresAll).toHaveLength(2);
      for (const first of [0, 1]) {
        const sim = funded();
        awaken(sim, `${fusion.region}_cast`);
        const a = SPELL_TREE_NODE_BY_ID.get(fusion.requiresAll[first])!,
          b = SPELL_TREE_NODE_BY_ID.get(fusion.requiresAll[1 - first])!;
        awaken(sim, a.requiresAll[0]);
        awaken(sim, a.id);
        expect(spellNodeStatus(sim.getState().spellTree, fusion.id)).toBe('requirements');
        expect(sim.execute({ type: 'activate_spell_node', nodeId: fusion.id })).toBe(false);
        awaken(sim, b.requiresAll[0]);
        awaken(sim, b.id);
        awaken(sim, fusion.id);
        expect(sim.getState().run.spell.mechanics?.[fusion.mechanics![0].key]).toBe(true);
      }
    });
  it('allows both optional side paths without requiring them for a mutation', () => {
    const sim = funded();
    for (const id of [
      'twin_cast',
      'explosive',
      'meteor_shower',
      'blast_radius_1',
      'blast_radius_2',
      'explosion_damage_1',
      'explosion_damage_2',
    ])
      awaken(sim, id);
    expect(sim.getState().run.spell.mechanics?.blastRadius).toBeCloseTo(2.35);
    expect(sim.getState().run.spell.mechanics?.explosionDamage).toBeCloseTo(0.65);
    sim.execute({ type: 'respec_spell_tree' });
    expect(sim.getState().run.spell.mechanics?.explosive).toBe(false);
  });
});
