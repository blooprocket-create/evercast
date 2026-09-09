import { describe, expect, it } from 'vitest';
import { SPELL_TREE_NODES } from '../../content/spellTree';
import { SPELL_TREE_GRAPH, SPELL_TREE_LAYOUT_OPTIONS } from '../spellTree/spellTreeGraph';
import { type GraphBox, type GraphNodeInput, layoutGraph } from './layoutGraph';

const overlaps = (a: GraphBox, b: GraphBox): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const chain: GraphNodeInput[] = [
  { id: 'a' },
  { id: 'b', requires: ['a'] },
  { id: 'c', requires: ['b'] },
];

describe('layoutGraph', () => {
  it('ranks by longest path, not by shortest', () => {
    // d depends on both a (rank 0) and c (rank 2), so it must land at rank 3.
    const layout = layoutGraph([...chain, { id: 'd', requires: ['a', 'c'] }]);
    expect(layout.boxes.get('d')?.rank).toBe(3);
    expect(layout.rankCount).toBe(4);
  });

  it('rejects a prerequisite cycle instead of hanging', () => {
    expect(() =>
      layoutGraph([
        { id: 'a', requires: ['b'] },
        { id: 'b', requires: ['a'] },
      ]),
    ).toThrow(/cycle/i);
  });

  it('rejects an unknown prerequisite and a duplicate id', () => {
    expect(() => layoutGraph([{ id: 'a', requires: ['ghost'] }])).toThrow(/unknown node/i);
    expect(() => layoutGraph([{ id: 'a' }, { id: 'a' }])).toThrow(/duplicate/i);
  });

  it('handles an empty graph', () => {
    const layout = layoutGraph([]);
    expect(layout.boxes.size).toBe(0);
    expect(layout.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('honours rankBias without letting a child rise above its parent', () => {
    const layout = layoutGraph([{ id: 'a' }, { id: 'b', requires: ['a'], rankBias: 2 }]);
    expect(layout.boxes.get('b')?.rank).toBe(3);
    expect(layout.boxes.get('b')!.y).toBeGreaterThan(layout.boxes.get('a')!.y);
  });

  it('packs lanes side by side and spans the designated lane across them', () => {
    const layout = layoutGraph(
      [
        { id: 'root', lane: 'core' },
        { id: 'l', lane: 'left', requires: ['root'] },
        { id: 'r', lane: 'right', requires: ['root'] },
      ],
      { spanLane: 'core' },
    );
    const root = layout.boxes.get('root')!;
    const left = layout.boxes.get('l')!;
    const right = layout.boxes.get('r')!;
    expect(left.x).toBeLessThan(right.x);
    const rootCentre = root.x + root.width / 2;
    const between = (left.x + left.width / 2 + right.x + right.width / 2) / 2;
    expect(rootCentre).toBeCloseTo(between, 6);
    expect(layout.lanes).toEqual(['left', 'right']);
  });
});

describe('the real spell tree', () => {
  const layout = layoutGraph(SPELL_TREE_GRAPH, SPELL_TREE_LAYOUT_OPTIONS);

  it('is the size we think it is', () => {
    expect(SPELL_TREE_NODES).toHaveLength(67);
    expect(layout.edges).toHaveLength(75);
  });

  it('places every authored node exactly once', () => {
    expect(layout.boxes.size).toBe(SPELL_TREE_NODES.length);
    for (const node of SPELL_TREE_NODES) {
      expect(layout.boxes.get(node.id), `missing layout for ${node.id}`).toBeDefined();
    }
  });

  it('keeps every node inside the reported bounds', () => {
    const { bounds } = layout;
    for (const box of layout.boxes.values()) {
      expect(box.x).toBeGreaterThanOrEqual(bounds.x);
      expect(box.y).toBeGreaterThanOrEqual(bounds.y);
      expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1e-6);
      expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1e-6);
    }
  });

  it('puts every prerequisite strictly above its dependent', () => {
    for (const node of SPELL_TREE_NODES) {
      const child = layout.boxes.get(node.id)!;
      for (const parentId of node.requiresAll) {
        const parent = layout.boxes.get(parentId)!;
        expect(
          parent.y + parent.height,
          `${parentId} should sit above ${node.id}`,
        ).toBeLessThanOrEqual(child.y);
      }
    }
  });

  it('never overlaps two nodes', () => {
    const boxes = [...layout.boxes.values()];
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        expect(
          overlaps(boxes[i], boxes[j]),
          `${boxes[i].id} overlaps ${boxes[j].id}`,
        ).toBe(false);
      }
    }
  });

  it('keeps the three routes in their own lanes', () => {
    expect(layout.lanes).toEqual(['twin', 'piercing', 'charged']);
    const laneOf = (id: string) => layout.boxes.get(id)!.lane;
    for (const node of SPELL_TREE_NODES) {
      if (node.region === 'core') continue;
      expect(laneOf(node.id)).toBe(node.region);
    }
  });

  it('centres the root above the routes', () => {
    const root = layout.boxes.get('evercast_root')!;
    expect(root.rank).toBe(0);
    const routes = SPELL_TREE_NODES.filter((n) => n.kind === 'route').map(
      (n) => layout.boxes.get(n.id)!,
    );
    const leftmost = Math.min(...routes.map((b) => b.x));
    const rightmost = Math.max(...routes.map((b) => b.x + b.width));
    const rootCentre = root.x + root.width / 2;
    expect(rootCentre).toBeGreaterThan(leftmost);
    expect(rootCentre).toBeLessThan(rightmost);
  });

  it('is deterministic across runs', () => {
    const again = layoutGraph(SPELL_TREE_GRAPH, SPELL_TREE_LAYOUT_OPTIONS);
    for (const [id, box] of layout.boxes) {
      expect(again.boxes.get(id)).toEqual(box);
    }
    expect(again.bounds).toEqual(layout.bounds);
  });
});
