import { describe, expect, it } from 'vitest';
import { SPELL_TREE_NODES } from '../../content/spellTree';
import {
  MAX_SPELL_TREE_POINTS,
  canActivateSpellNode,
  spellNodeStatus,
} from '../../engine/spellTree/SpellTreeSystem';
import type { SpellTreeState } from '../../engine/spellTree/types';
import { spellNodeStatuses, spellTreeStateKey } from './spellNodeStatuses';

const clone = (state: SpellTreeState): SpellTreeState => ({
  purchasedPoints: state.purchasedPoints,
  activatedNodeIds: [...state.activatedNodeIds],
});

/** Deterministic walk that only ever takes moves the engine permits. */
function reachableState(seed: number, steps: number, purchasedPoints = MAX_SPELL_TREE_POINTS): SpellTreeState {
  let random = seed;
  const next = () => {
    random = (random * 1103515245 + 12345) % 2147483648;
    return random / 2147483648;
  };

  const state: SpellTreeState = { purchasedPoints, activatedNodeIds: [] };
  for (let step = 0; step < steps; step += 1) {
    const options = SPELL_TREE_NODES.filter((node) => canActivateSpellNode(state, node.id));
    if (options.length === 0) break;
    state.activatedNodeIds.push(options[Math.floor(next() * options.length)].id);
  }
  return state;
}

const STATES: [string, SpellTreeState][] = [
  ['fresh', { purchasedPoints: 0, activatedNodeIds: [] }],
  ['one point, nothing spent', { purchasedPoints: 1, activatedNodeIds: [] }],
  ['points exhausted', { purchasedPoints: 0, activatedNodeIds: reachableState(7, 1).activatedNodeIds }],
  ['a route and two identities', reachableState(11, 4)],
  ['mid build', reachableState(23, 12)],
  ['deep build', reachableState(41, 30)],
  ['saturated', reachableState(97, MAX_SPELL_TREE_POINTS)],
  ['respecced back to empty', { purchasedPoints: 9, activatedNodeIds: [] }],
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

  it('covers all 67 nodes', () => {
    expect(SPELL_TREE_NODES).toHaveLength(67);
    for (const [, state] of STATES) {
      expect(spellNodeStatuses(state).size).toBe(67);
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
});

describe('spellTreeStateKey', () => {
  it('changes whenever the status map could change', () => {
    const a: SpellTreeState = { purchasedPoints: 2, activatedNodeIds: ['x', 'y'] };
    expect(spellTreeStateKey(a)).toBe(spellTreeStateKey(clone(a)));
    expect(spellTreeStateKey(a)).not.toBe(
      spellTreeStateKey({ purchasedPoints: 3, activatedNodeIds: ['x', 'y'] }),
    );
    expect(spellTreeStateKey(a)).not.toBe(
      spellTreeStateKey({ purchasedPoints: 2, activatedNodeIds: ['x'] }),
    );
  });

  it('is stable across the fresh arrays every snapshot build produces', () => {
    const state = reachableState(23, 12);
    const rebuilt: SpellTreeState = {
      purchasedPoints: state.purchasedPoints,
      activatedNodeIds: [...state.activatedNodeIds],
    };
    expect(rebuilt.activatedNodeIds).not.toBe(state.activatedNodeIds);
    expect(spellTreeStateKey(rebuilt)).toBe(spellTreeStateKey(state));
  });
});
