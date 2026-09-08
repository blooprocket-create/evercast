import { describe, expect, it } from 'vitest';
import { SPELL_TREE_NODES } from '../../content/spellTree';
import { SPELL_TREE_LAYOUT, SPELL_TREE_VIEWBOX } from './SpellTreeLayout';

describe('SpellTreeLayout', () => {
  it('provides one in-bounds UI position for every authored node', () => {
    expect(Object.keys(SPELL_TREE_LAYOUT).sort()).toEqual(SPELL_TREE_NODES.map((node) => node.id).sort());

    for (const node of SPELL_TREE_NODES) {
      const layout = SPELL_TREE_LAYOUT[node.id];
      expect(layout.x, node.id).toBeGreaterThanOrEqual(0);
      expect(layout.x, node.id).toBeLessThanOrEqual(SPELL_TREE_VIEWBOX.width);
      expect(layout.y, node.id).toBeGreaterThanOrEqual(0);
      expect(layout.y, node.id).toBeLessThanOrEqual(SPELL_TREE_VIEWBOX.height);
    }
  });
});
