import { describe, expect, it } from 'vitest';
import { EvercastSimulation } from '../EvercastSimulation';
import { big } from '../numbers';
import { SPELL_TREE_NODES, SPELL_TREE_NODE_BY_ID, spellPointCost } from '../../content/spellTree';
import { blockingAttunement, maxAllocatableSpellPoints, spellNodeStatus } from './SpellTreeSystem';

/** Every point the base rule set can absorb: one route, two identities, one fusion. */
const BASE_CEILING = maxAllocatableSpellPoints([]);
function funded() {
  const sim = new EvercastSimulation();
  sim.getState().run.essence = big('1e20');
  // Buy right up to the ceiling the current rules allow, rather than a fixed
  // count: the ceiling now moves with the attunements.
  while (sim.getSnapshot().spellTreeTotalPoints < BASE_CEILING)
    expect(sim.execute({ type: 'buy_spell_point' })).toBe(true);
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
    while (sim.getSnapshot().spellTreeTotalPoints < BASE_CEILING)
      expect(sim.execute({ type: 'buy_spell_point' })).toBe(true);
    const before = sim.getSnapshot().essence.raw;
    // The ceiling is what a build can actually spend, so the tree stops selling
    // points instead of taking Essence for allocations that cannot exist.
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
      expect(sim.getSnapshot().spellTreeUnspentPoints).toBe(BASE_CEILING);
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

describe('the purchase ceiling', () => {
  it('is the largest build the rules allow, not the node count', () => {
    // One route, two identities, their six side ranks each, two mutations and
    // the one fusion those two mutations share.
    expect(BASE_CEILING).toBe(18);
    expect(BASE_CEILING).toBeLessThan(SPELL_TREE_NODES.length - 1);
  });

  it('widens with each attunement, up to everything but the capstone not taken', () => {
    // The apex tier only appears with the third identity: it needs all three
    // fusions of a route, and two identities can only ever produce one.
    expect(maxAllocatableSpellPoints(['third_identity'])).toBe(35);
    expect(maxAllocatableSpellPoints(['second_route'])).toBe(36);
    expect(maxAllocatableSpellPoints(['third_identity', 'second_route'])).toBe(70);
    const everything = maxAllocatableSpellPoints([
      'third_identity',
      'second_route',
      'third_route',
    ]);
    expect(everything).toBe(105);
    // Short of the node count, and deliberately: each route ends in one of two
    // capstones, so the tree never collapses into taking all of it.
    const apexBranch = SPELL_TREE_NODES.filter(
      (node) => node.kind === 'apex' || node.id.match(/^(necrosis|cascade|reclaim)_/),
    ).length;
    expect(everything).toBeLessThan(SPELL_TREE_NODES.length - 1);
    expect(apexBranch).toBeGreaterThan(0);
  });

  it('reports a ceiling a real allocation can actually reach', () => {
    for (const attunements of [[], ['third_identity'], ['third_identity', 'second_route']]) {
      const sim = new EvercastSimulation();
      sim.getState().spellTree.attunements = [...attunements];
      sim.getState().run.essence = big('1e40');
      while (sim.execute({ type: 'buy_spell_point' }));
      let spent = 0;
      for (let progressed = true; progressed; ) {
        progressed = false;
        for (const node of SPELL_TREE_NODES)
          if (sim.execute({ type: 'activate_spell_node', nodeId: node.id })) {
            spent += 1;
            progressed = true;
          }
      }
      // Every point bought found a home: no Essence was taken for nothing.
      expect(spent).toBe(maxAllocatableSpellPoints(attunements));
      expect(sim.getSnapshot().spellTreeUnspentPoints).toBe(0);
    }
  });
});

describe('attunements', () => {
  function knowledgeable(knowledge: number) {
    const sim = new EvercastSimulation();
    sim.getState().meta.knowledge = big(knowledge);
    return sim;
  }

  it('spends Knowledge and is not refunded by a respec', () => {
    const sim = knowledgeable(10);
    expect(sim.execute({ type: 'buy_attunement', attunementId: 'third_identity' })).toBe(true);
    expect(sim.getState().meta.knowledge.toString()).toBe('9');
    expect(sim.getSnapshot().ownedAttunementIds).toEqual(['third_identity']);

    sim.getState().run.essence = big('1e20');
    sim.execute({ type: 'buy_spell_point' });
    sim.execute({ type: 'activate_spell_node', nodeId: 'twin_cast' });
    sim.execute({ type: 'respec_spell_tree' });
    expect(sim.getSnapshot().ownedAttunementIds).toEqual(['third_identity']);
    expect(sim.getState().meta.knowledge.toString()).toBe('9');
  });

  it('refuses an unaffordable, unknown, repeated or out-of-order purchase', () => {
    const poor = knowledgeable(0);
    expect(poor.execute({ type: 'buy_attunement', attunementId: 'third_identity' })).toBe(false);
    expect(poor.getState().meta.knowledge.toString()).toBe('0');

    const rich = knowledgeable(1000);
    expect(rich.execute({ type: 'buy_attunement', attunementId: 'nonsense' })).toBe(false);
    // third_route requires second_route, and says so rather than silently taking the Knowledge.
    expect(rich.execute({ type: 'buy_attunement', attunementId: 'third_route' })).toBe(false);
    expect(rich.getState().meta.knowledge.toString()).toBe('1000');
    expect(rich.execute({ type: 'buy_attunement', attunementId: 'second_route' })).toBe(true);
    expect(rich.execute({ type: 'buy_attunement', attunementId: 'second_route' })).toBe(false);
    expect(rich.execute({ type: 'buy_attunement', attunementId: 'third_route' })).toBe(true);
  });

  it('opens the third identity and the two fusions that needed it', () => {
    const sim = funded();
    awaken(sim, 'twin_cast');
    awaken(sim, 'explosive');
    awaken(sim, 'damage_over_time');
    expect(spellNodeStatus(sim.getState().spellTree, 'debuff')).toBe('exclusive');

    sim.getState().meta.knowledge = big(5);
    expect(sim.execute({ type: 'buy_attunement', attunementId: 'third_identity' })).toBe(true);
    // Buying the unlock does not buy the points; it only makes them spendable.
    sim.getState().run.essence = big('1e20');
    while (sim.execute({ type: 'buy_spell_point' }));
    expect(spellNodeStatus(sim.getState().spellTree, 'debuff')).toBe('available');

    awaken(sim, 'debuff');
    awaken(sim, 'meteor_shower');
    awaken(sim, 'contagion');
    awaken(sim, 'ruin');
    for (const fusion of ['plaguefall', 'doomfall', 'blight']) awaken(sim, fusion);
    expect(sim.getState().run.spell.mechanics?.blight).toBe(true);
  });

  it('names the attunement that would let a blocked node be held as well', () => {
    const sim = funded();
    awaken(sim, 'twin_cast');
    // A respec would swap Twin for Piercing; only Schism holds both.
    expect(blockingAttunement(sim.getState().spellTree, 'piercing_cast')).toBe('second_route');
    awaken(sim, 'explosive');
    awaken(sim, 'damage_over_time');
    expect(blockingAttunement(sim.getState().spellTree, 'debuff')).toBe('third_identity');
    expect(blockingAttunement(sim.getState().spellTree, 'meteor_shower')).toBe(null);
  });
});

describe('side upgrade ranks', () => {
  it('chains rank III off rank II and stacks all three bonuses', () => {
    const sim = funded();
    for (const id of ['twin_cast', 'explosive']) awaken(sim, id);
    expect(spellNodeStatus(sim.getState().spellTree, 'blast_radius_3')).toBe('requirements');
    awaken(sim, 'blast_radius_1');
    expect(spellNodeStatus(sim.getState().spellTree, 'blast_radius_3')).toBe('requirements');
    awaken(sim, 'blast_radius_2');
    awaken(sim, 'blast_radius_3');
    // 1.65 base plus three ranks of +0.35.
    expect(sim.getState().run.spell.mechanics?.blastRadius).toBeCloseTo(2.7);
  });
});

describe('the apex tier', () => {
  it('needs all three fusions of its route, so Broadened Study gates it', () => {
    const apexes = SPELL_TREE_NODES.filter((node) => node.kind === 'apex');
    // Two per route: one that answers a hit, one that answers a death.
    expect(apexes).toHaveLength(6);
    for (const region of ['twin', 'piercing', 'charged'])
      expect(apexes.filter((node) => node.region === region)).toHaveLength(2);
    for (const apex of apexes) {
      expect(apex.requiresAll).toHaveLength(3);
      for (const id of apex.requiresAll)
        expect(SPELL_TREE_NODE_BY_ID.get(id)?.kind, `${apex.id} requires ${id}`).toBe('fusion');
    }

    // Two identities can only ever produce one fusion, so no apex is reachable
    // on the base rules however many points are bought - the third identity is
    // locked out, and the lock carries all the way down to the capstone.
    const sim = funded();
    awaken(sim, 'twin_cast');
    awaken(sim, 'explosive');
    awaken(sim, 'damage_over_time');
    awaken(sim, 'meteor_shower');
    awaken(sim, 'contagion');
    awaken(sim, 'plaguefall');
    expect(spellNodeStatus(sim.getState().spellTree, 'pandemic')).toBe('exclusive');
    expect(blockingAttunement(sim.getState().spellTree, 'pandemic')).toBe('third_identity');
  });

  it('awakens once its route is complete, and carries its own rank ladder', () => {
    const sim = new EvercastSimulation();
    sim.getState().meta.knowledge = big(10);
    expect(sim.execute({ type: 'buy_attunement', attunementId: 'third_identity' })).toBe(true);
    sim.getState().run.essence = big('1e30');
    while (sim.execute({ type: 'buy_spell_point' }));

    for (const id of [
      'twin_cast',
      'explosive',
      'damage_over_time',
      'debuff',
      'meteor_shower',
      'contagion',
      'ruin',
      'plaguefall',
      'doomfall',
      'blight',
    ])
      awaken(sim, id);

    awaken(sim, 'pandemic');
    expect(sim.getState().run.spell.mechanics?.pandemic).toBe(true);
    awaken(sim, 'pandemic_reach_1');
    awaken(sim, 'pandemic_reach_2');
    // Base 2 neighbours, plus one per rank.
    expect(sim.getState().run.spell.mechanics?.pandemicTargets).toBe(4);
  });
});
