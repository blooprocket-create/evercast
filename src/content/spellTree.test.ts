import { describe, expect, it } from 'vitest';
import { SPELL_TREE_NODE_BY_ID, SPELL_TREE_NODES, SPELL_TREE_ROOT_ID } from './spellTree';

describe('authored spell tree content', () => {
  it('has unique node IDs and a valid root', () => {
    expect(SPELL_TREE_NODE_BY_ID.size).toBe(SPELL_TREE_NODES.length);
    expect(SPELL_TREE_NODE_BY_ID.get(SPELL_TREE_ROOT_ID)?.kind).toBe('root');
  });

  it('has no dangling path requirements', () => {
    for (const node of SPELL_TREE_NODES) {
      for (const requiredId of node.requires) {
        expect(SPELL_TREE_NODE_BY_ID.has(requiredId), `${node.id} requires missing ${requiredId}`).toBe(true);
      }
    }
  });

  it('keeps the root free of gameplay modifiers and prerequisites', () => {
    const root = SPELL_TREE_NODE_BY_ID.get(SPELL_TREE_ROOT_ID)!;
    expect(root.requires).toEqual([]);
    expect(root.modifiers).toEqual([]);
  });
});
