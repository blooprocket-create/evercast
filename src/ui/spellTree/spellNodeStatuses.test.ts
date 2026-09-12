import { describe, expect, it } from 'vitest';
import { SPELL_ATTUNEMENTS, SPELL_TREE_NODES } from '../../content/spellTree';
import {
  SPELL_TREE_NODE_COUNT,
  canActivateSpellNode,
  spellNodeStatus,
} from '../../engine/spellTree/SpellTreeSystem';
import type { SpellTreeState } from '../../engine/spellTree/types';
import { spellNodeStatuses, spellTreeStateKey } from './spellNodeStatuses';

const ALL_ATTUNEMENTS = SPELL_ATTUNEMENTS.map((attunement) => attunement.id);

const clone = (state: SpellTreeState): SpellTreeState => ({
  purchasedPoints: state.purchasedPoints,
  activatedNodeIds: [...state.activatedNodeIds],
  attunements: [...state.attunements],
});

const empty = (purchasedPoints: number, attunements: string[] = []): SpellTreeState => ({
  purchasedPoints,
  activatedNodeIds: [],
  attunements,
});

/** Deterministic walk that only ever takes moves the engine permits. */
function reachableState(
  seed: number,
  steps: number,
  purchasedPoints = SPELL_TREE_NODE_COUNT,
  attunements: string[] = [],
): SpellTreeState {
  let random = seed;
  const next = () => {
    random = (random * 1103515245 + 12345) % 2147483648;
    return random / 2147483648;
  };

  const state: SpellTreeState = { purchasedPoints, activatedNodeIds: [], attunements };
  for (let step = 0; step < steps; step += 1) {
    const options = SPELL_TREE_NODES.filter((node) => canActivateSpellNode(state, node.id));
    if (options.length === 0) break;
    state.activatedNodeIds.push(options[Math.floor(next() * options.length)].id);
  }
  return state;
}

const STATES: [string, SpellTreeState][] = [
  ['fresh', empty(0)],
  ['one point, nothing spent', empty(1)],
  ['points exhausted', { ...empty(0), activatedNodeIds: reachableState(7, 1).activatedNodeIds }],
  ['a route and two identities', reachableState(11, 4)],
  ['mid build', reachableState(23, 12)],
  ['deep build', reachableState(41, 30)],
  ['saturated', reachableState(97, SPELL_TREE_NODE_COUNT)],
  ['respecced back to empty', empty(9)],
  // The unlocks move the group caps, so every one of them is its own rule set.
  ['third identity, nothing spent', empty(SPELL_TREE_NODE_COUNT, ['third_identity'])],
  ['third identity, deep build', reachableState(53, 30, SPELL_TREE_NODE_COUNT, ['third_identity'])],
  ['two routes', reachableState(61, 40, SPELL_TREE_NODE_COUNT, ['second_route'])],
  [
    'every attunement, saturated',
    reachableState(83, SPELL_TREE_NODE_COUNT, SPELL_TREE_NODE_COUNT, ALL_ATTUNEMENTS),
  ],
];

describe('spellNodeStatuses', () => {
  it('agrees with the engine on every node in every reachable state', () => {
    for (const [label, state] of STATES) {
      const map = spellNodeStatuses(state);
      for (const node of SPELL_TREE_NODES) {
        expect(
          map.get(node.id),
          `${label}: ${node.id} (${node.kind}/${node.region})`,
        ).toBe(spellNodeStatus(state, node.id));
      }
    }
  });

  it('covers every authored node', () => {
    expect(SPELL_TREE_NODES).toHaveLength(SPELL_TREE_NODE_COUNT + 1);
    for (const [, state] of STATES) {
      expect(spellNodeStatuses(state).size).toBe(SPELL_TREE_NODES.length);
    }
  });

  it('actually exercises every status the engine can return', () => {
    const seen = new Set<string>();
    for (const [, state] of STATES) {
      for (const status of spellNodeStatuses(state).values()) seen.add(status);
    }
    expect([...seen].sort()).toEqual(
      ['active', 'available', 'exclusive', 'points', 'requirements'].sort(),
    );
  });

  it('does not mutate the state it is given', () => {
    const state = reachableState(23, 12);
    const before = clone(state);
    spellNodeStatuses(state);
    expect(state).toEqual(before);
  });

  it('locks a whole route once its exclusive group fills', () => {
    const state = reachableState(11, 4);
    const map = spellNodeStatuses(state);
    const chosenRoute = SPELL_TREE_NODES.find(
      (node) => node.kind === 'route' && state.activatedNodeIds.includes(node.id),
    );
    expect(chosenRoute).toBeDefined();
    const others = SPELL_TREE_NODES.filter(
      (node) => node.kind === 'route' && node.id !== chosenRoute!.id,
    );
    expect(others).toHaveLength(2);
    for (const route of others) expect(map.get(route.id)).toBe('exclusive');
    // ...and the descendants of a locked route are locked too, not merely unmet.
    const orphan = SPELL_TREE_NODES.find(
      (node) => node.kind === 'identity' && node.region === others[0].region,
    );
    expect(map.get(orphan!.id)).toBe('exclusive');
  });

  it('stops locking anything once every attunement is owned', () => {
    // Each group's cap then equals the number of choices in it, so exclusivity
    // is spent as a mechanic and the whole graph is reachable in one build.
    const state = reachableState(83, SPELL_TREE_NODE_COUNT, SPELL_TREE_NODE_COUNT, ALL_ATTUNEMENTS);
    expect(state.activatedNodeIds).toHaveLength(SPELL_TREE_NODE_COUNT);
    for (const status of spellNodeStatuses(state).values()) expect(status).toBe('active');
  });
});

describe('spellTreeStateKey', () => {
  it('changes whenever the status map could change', () => {
    const a: SpellTreeState = { purchasedPoints: 2, activatedNodeIds: ['x', 'y'], attunements: [] };
    expect(spellTreeStateKey(a)).toBe(spellTreeStateKey(clone(a)));
    expect(spellTreeStateKey(a)).not.toBe(
      spellTreeStateKey({ ...a, purchasedPoints: 3 }),
    );
    expect(spellTreeStateKey(a)).not.toBe(
      spellTreeStateKey({ ...a, activatedNodeIds: ['x'] }),
    );
    // An unlock changes the caps without touching points or allocations.
    expect(spellTreeStateKey(a)).not.toBe(
      spellTreeStateKey({ ...a, attunements: ['third_identity'] }),
    );
  });

  it('is stable across the fresh arrays every snapshot build produces', () => {
    const state = reachableState(23, 12);
    const rebuilt: SpellTreeState = {
      purchasedPoints: state.purchasedPoints,
      activatedNodeIds: [...state.activatedNodeIds],
      attunements: [...state.attunements],
    };
    expect(rebuilt.activatedNodeIds).not.toBe(state.activatedNodeIds);
    expect(spellTreeStateKey(rebuilt)).toBe(spellTreeStateKey(state));
  });
});
