import { describe, expect, it } from 'vitest';
import { EvercastSimulation } from '../EvercastSimulation';
import { DEFAULT_ENGINE_CONFIG } from '../config';
import { big } from '../numbers';
import { OfflineProgressor } from '../offline/OfflineProgressor';
import { SPELL_TREE_NODES, SPELL_TREE_NODE_BY_ID } from '../../content/spellTree';
import { SaveCodec } from './SaveCodec';
import { createInitialGameState } from '../state';
import { combatState } from '../combat/SpellCombatState';
import { spellNodeStatus } from '../spellTree/SpellTreeSystem';
const codec = new SaveCodec(DEFAULT_ENGINE_CONFIG);
function build(fusion: string) {
  const initial = createInitialGameState(DEFAULT_ENGINE_CONFIG);
  initial.equipment.pieces.robe.level = 1000;
  const sim = new EvercastSimulation({ initialState: initial });
  sim.getState().spellTree.purchasedPoints = 20;
  function activate(id: string) {
    if (id === 'evercast_root' || sim.getState().spellTree.activatedNodeIds.includes(id)) return;
    SPELL_TREE_NODE_BY_ID.get(id)!.requiresAll.forEach(activate);
    expect(sim.execute({ type: 'activate_spell_node', nodeId: id })).toBe(true);
  }
  activate(fusion);
  sim.advance(2);
  for (const enemy of sim.getState().run.enemies) {
    enemy.hp = big(10000);
    enemy.maxHp = big(10000);
  }
  return sim;
}
function normalized(sim: EvercastSimulation) {
  const value = codec.encode(sim.getState(), new Date(0));
  return JSON.parse(
    JSON.stringify(value, (_key, v) => {
      if (typeof v === 'number') return Math.round(v * 1e7) / 1e7;
      if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) && Math.abs(Number(v)) < 1e8)
        return (Math.round(Number(v) * 1e7) / 1e7).toString();
      return v;
    }),
  );
}
describe('spell tree save migration and authoritative clock', () => {
  it('refunds all v5 allocations without changing purchased points, Essence, Gold, gear or meta, once', () => {
    const sim = build('plaguefall');
    const state = sim.getState();
    state.run.essence = big(1234);
    state.equipment.gold = big('1e35');
    state.equipment.pieces.staff.level = 42;
    state.meta.highestStageEver = 71;
    state.meta.rebirths = 3;
    const old = codec.encode(state) as unknown as {
      version: number;
      state: { spellTree: { purchasedPoints: number; activatedNodeIds: string[]; attunements?: string[] } };
    };
    old.version = 5;
    old.state.spellTree.activatedNodeIds = ['power_1', 'power_2', 'fire_entry', 'fire_mutation']; // Deliberate removed-node migration fixture.
    const migrated = codec.decode(JSON.parse(JSON.stringify(old))).state;
    expect(migrated.spellTree).toEqual({ purchasedPoints: 20, activatedNodeIds: [], attunements: [] });
    expect(migrated.run.essence.toString()).toBe('1234');
    expect(migrated.equipment.gold.toString()).toBe('1e35');
    expect(migrated.equipment.pieces).toEqual(state.equipment.pieces);
    expect(migrated.meta).toEqual(state.meta);
    expect(migrated.run.spell.mechanics?.route).toBe('base');
    expect(migrated.run.combatState?.meteors).toEqual([]);
    const again = codec.decode(JSON.parse(JSON.stringify(codec.encode(migrated)))).state;
    expect(again.spellTree).toEqual(migrated.spellTree);
    expect(again.run.essence.toString()).toBe('1234');
  });
  it('v6 refuses invalid exclusive allocations and never invents purchased points', () => {
    const raw = codec.encode(new EvercastSimulation().getState());
    raw.state.spellTree = {
      purchasedPoints: 0,
      activatedNodeIds: ['twin_cast', 'charged_cast', 'explosive', 'meteor_shower'],
    };
    const restored = codec.decode(raw).state;
    expect(restored.spellTree).toEqual({
      purchasedPoints: 0,
      activatedNodeIds: ['twin_cast'],
      attunements: [],
    });
  });
  for (const fusion of SPELL_TREE_NODES.filter((n) => n.kind === 'fusion'))
    it(`${fusion.name}: chunked, offline and save-resumed simulation agree`, () => {
      const source = build(fusion.id),
        encoded = JSON.stringify(codec.encode(source.getState()));
      const whole = new EvercastSimulation({ initialState: codec.decode(JSON.parse(encoded)).state });
      const chunks = new EvercastSimulation({ initialState: codec.decode(JSON.parse(encoded)).state });
      const offline = new EvercastSimulation({ initialState: codec.decode(JSON.parse(encoded)).state });
      whole.advance(20);
      for (let i = 0; i < 160; i++) chunks.advance(0.125);
      new OfflineProgressor(100).apply(offline, 20);
      expect(normalized(chunks)).toEqual(normalized(whole));
      expect(normalized(offline)).toEqual(normalized(whole));
      const restored = new EvercastSimulation({
        initialState: codec.decode(JSON.parse(JSON.stringify(codec.encode(chunks.getState())))).state,
      });
      restored.advance(5);
      whole.advance(5);
      expect(normalized(restored)).toEqual(normalized(whole));
    });
  it('persists a pending meteor and DoT exactly, then resolves them after load', () => {
    const sim = build('plaguefall');
    const run = sim.getState().run;
    // Wait for a real deterministic proc, saving before its scheduled impact.
    let tries = 0;
    while (!run.combatState?.meteors.length && tries++ < 300) sim.advance(0.05);
    expect(run.combatState?.meteors.length).toBeGreaterThan(0);
    const saved = codec.encode(sim.getState()),
      copy = JSON.stringify(saved);
    sim.advance(2);
    expect(JSON.stringify(saved)).toBe(copy);
    const restored = new EvercastSimulation({ initialState: codec.decode(JSON.parse(copy)).state });
    restored.advance(2);
    expect(normalized(restored)).toEqual(normalized(sim));
  });
  it('respec clears pending effects and temporary resources without removing enemies or loot', () => {
    const sim = build('plaguefall'),
      state = sim.getState();
    const runtime = combatState(state.run);
    runtime.focus = 3;
    runtime.supercharge = 4;
    runtime.velocityStored = '400';
    const ids = state.run.enemies.map((e) => e.instanceId),
      gold = state.equipment.gold.toString();
    sim.execute({ type: 'respec_spell_tree' });
    expect(state.run.enemies.map((e) => e.instanceId)).toEqual(ids);
    expect(state.run.enemies.every((e) => !e.statuses?.dot)).toBe(true);
    expect(state.run.combatState?.focus).toBe(0);
    expect(state.run.combatState?.meteors).toEqual([]);
    expect(state.equipment.gold.toString()).toBe(gold);
  });
});

describe('version 8 attunements', () => {
  it('round-trips attunements and keeps a v7 save on the original rules', () => {
    const sim = new EvercastSimulation();
    sim.getState().meta.knowledge = big(100);
    expect(sim.execute({ type: 'buy_attunement', attunementId: 'third_identity' })).toBe(true);
    expect(sim.execute({ type: 'buy_attunement', attunementId: 'second_route' })).toBe(true);

    const encoded = codec.encode(sim.getState());
    expect(encoded.version).toBe(8);
    expect(encoded.state.spellTree.attunements).toEqual(['third_identity', 'second_route']);

    const restored = codec.decode(JSON.parse(JSON.stringify(encoded))).state;
    expect(restored.spellTree.attunements).toEqual(['third_identity', 'second_route']);

    // The same bytes read as v7 predate the field entirely.
    const asV7 = JSON.parse(JSON.stringify(encoded));
    asV7.version = 7;
    delete asV7.state.spellTree.attunements;
    expect(codec.decode(asV7).state.spellTree.attunements).toEqual([]);
  });

  it('will not let a hand-edited save widen the tree past its own prerequisites', () => {
    const raw = codec.encode(new EvercastSimulation().getState());
    raw.state.spellTree = {
      purchasedPoints: 40,
      activatedNodeIds: [],
      // third_route without second_route, plus an invented one.
      attunements: ['third_route', 'not_an_attunement'],
    };
    const restored = codec.decode(JSON.parse(JSON.stringify(raw))).state;
    expect(restored.spellTree.attunements).toEqual([]);
  });

  it('drops allocations that a missing attunement makes illegal, without minting points', () => {
    const raw = codec.encode(new EvercastSimulation().getState());
    raw.state.spellTree = {
      purchasedPoints: 40,
      // A legal two-route build, saved by a player who then lost the unlock.
      activatedNodeIds: ['twin_cast', 'piercing_cast', 'explosive', 'deep_pierce'],
      attunements: [],
    };
    const restored = codec.decode(JSON.parse(JSON.stringify(raw))).state;
    expect(restored.spellTree.activatedNodeIds).toEqual(['twin_cast', 'explosive']);
    expect(restored.spellTree.purchasedPoints).toBe(40);
  });

  it('keeps a two-route build intact when the attunement is still held', () => {
    const raw = codec.encode(new EvercastSimulation().getState());
    raw.state.spellTree = {
      purchasedPoints: 40,
      activatedNodeIds: ['twin_cast', 'piercing_cast', 'explosive', 'deep_pierce'],
      attunements: ['second_route'],
    };
    const restored = codec.decode(JSON.parse(JSON.stringify(raw))).state;
    expect(restored.spellTree.activatedNodeIds).toEqual([
      'twin_cast',
      'piercing_cast',
      'explosive',
      'deep_pierce',
    ]);
  });
});

describe('the complete pre-expansion build', () => {
  /** Exactly what a v7 save looked like at the old 14-point ceiling. */
  const COMPLETED_V7 = [
    'twin_cast',
    'damage_over_time',
    'explosive',
    'meteor_shower',
    'contagion',
    'plaguefall',
    'explosion_damage_1',
    'explosion_damage_2',
    'dot_damage_1',
    'dot_damage_2',
    'dot_duration_1',
    'dot_duration_2',
    'blast_radius_1',
    'blast_radius_2',
  ];

  it('keeps every node and gives the stranded point somewhere to go', () => {
    const raw = codec.encode(new EvercastSimulation().getState()) as unknown as {
      version: number;
      state: { spellTree: { purchasedPoints: number; activatedNodeIds: string[] } };
    };
    raw.version = 7;
    raw.state.spellTree = { purchasedPoints: 14, activatedNodeIds: [...COMPLETED_V7] };

    const restored = codec.decode(JSON.parse(JSON.stringify(raw))).state;
    expect(restored.spellTree.activatedNodeIds).toEqual(COMPLETED_V7);
    expect(restored.spellTree.purchasedPoints).toBe(14);
    expect(restored.run.spell.mechanics?.plaguefall).toBe(true);

    // One point over a 14-node build, and rank III is what it now buys.
    const sim = new EvercastSimulation({ initialState: restored });
    expect(sim.getSnapshot().spellTreeUnspentPoints).toBe(1);
    const available = SPELL_TREE_NODES.filter(
      (node) => spellNodeStatus(restored.spellTree, node.id) === 'available',
    ).map((node) => node.id);
    expect(available).toEqual([
      'blast_radius_3',
      'explosion_damage_3',
      'dot_damage_3',
      'dot_duration_3',
    ]);
  });
});

describe('a blended two-route build', () => {
  /** Twin and Piercing held at once, which only Schism allows. */
  function blended() {
    const initial = createInitialGameState(DEFAULT_ENGINE_CONFIG);
    initial.equipment.pieces.robe.level = 1000;
    const sim = new EvercastSimulation({ initialState: initial });
    sim.getState().spellTree.purchasedPoints = 60;
    sim.getState().spellTree.attunements = ['third_identity', 'second_route'];
    for (const id of [
      'twin_cast',
      'piercing_cast',
      'explosive',
      'meteor_shower',
      'damage_over_time',
      'contagion',
      'plaguefall',
      'deep_pierce',
      'chain_lightning',
      'driving_force',
      'kinetic_collapse',
      'terminal_voltage',
    ])
      expect(sim.execute({ type: 'activate_spell_node', nodeId: id }), id).toBe(true);
    sim.advance(2);
    for (const enemy of sim.getState().run.enemies) {
      enemy.hp = big(10000);
      enemy.maxHp = big(10000);
    }
    return sim;
  }

  it('holds both routes at once and reports the heavier one', () => {
    const mechanics = blended().getState().run.spell.mechanics!;
    expect(mechanics.twinCast).toBe(true);
    expect(mechanics.piercingCast).toBe(true);
    expect(mechanics.chargedCast).toBe(false);
    expect(mechanics.route).toBe('piercing');
  });

  it('agrees across chunked, offline and save-resumed simulation', () => {
    const encoded = JSON.stringify(codec.encode(blended().getState()));
    const whole = new EvercastSimulation({ initialState: codec.decode(JSON.parse(encoded)).state });
    const chunks = new EvercastSimulation({ initialState: codec.decode(JSON.parse(encoded)).state });
    const offline = new EvercastSimulation({ initialState: codec.decode(JSON.parse(encoded)).state });
    whole.advance(20);
    for (let i = 0; i < 160; i++) chunks.advance(0.125);
    new OfflineProgressor(100).apply(offline, 20);
    expect(normalized(chunks)).toEqual(normalized(whole));
    expect(normalized(offline)).toEqual(normalized(whole));

    const restored = new EvercastSimulation({
      initialState: codec.decode(JSON.parse(JSON.stringify(codec.encode(chunks.getState())))).state,
    });
    restored.advance(5);
    whole.advance(5);
    expect(normalized(restored)).toEqual(normalized(whole));
  });
});
