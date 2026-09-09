import { describe, expect, it } from 'vitest';
import { SPELL_TREE_NODES } from '../../content/spellTree';
import { SPELL_TREE_GRAPH, SPELL_TREE_LAYOUT_OPTIONS } from '../spellTree/spellTreeGraph';
import type { GraphBox } from './layoutGraph';
import { layoutRadial } from './layoutRadial';

const overlaps = (a: GraphBox, b: GraphBox): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const centre = (box: GraphBox) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
const radiusOf = (box: GraphBox) => Math.hypot(centre(box).x, centre(box).y);

describe('layoutRadial', () => {
  const layout = layoutRadial(SPELL_TREE_GRAPH, SPELL_TREE_LAYOUT_OPTIONS);

  it('places every authored node', () => {
    expect(layout.boxes.size).toBe(SPELL_TREE_NODES.length);
  });

  it('puts the root at the centre', () => {
    const root = centre(layout.boxes.get('evercast_root')!);
    expect(root.x).toBeCloseTo(0, 6);
    expect(root.y).toBeCloseTo(0, 6);
  });

  it('pushes each rank onto a ring further out than the last', () => {
    const byRank = new Map<number, number>();
    for (const box of layout.boxes.values()) {
      if (box.id === 'evercast_root') continue;
      const existing = byRank.get(box.rank);
      const radius = radiusOf(box);
      // Every node in a rank shares a ring.
      if (existing !== undefined) expect(radius).toBeCloseTo(existing, 3);
      byRank.set(box.rank, radius);
    }
    const radii = [...byRank.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r);
    for (let i = 1; i < radii.length; i += 1) expect(radii[i]).toBeGreaterThan(radii[i - 1]);
  });

  it('keeps each route in its own wedge', () => {
    const angles = new Map<string, number[]>();
    for (const box of layout.boxes.values()) {
      if (box.id === 'evercast_root') continue;
      const { x, y } = centre(box);
      const angle = Math.atan2(y, x);
      const list = angles.get(box.lane);
      if (list) list.push(angle);
      else angles.set(box.lane, [angle]);
    }
    expect([...angles.keys()].sort()).toEqual(['charged', 'piercing', 'twin']);
  });

  it('never overlaps two nodes', () => {
    const boxes = [...layout.boxes.values()];
    const collisions: string[] = [];
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        if (overlaps(boxes[i], boxes[j])) collisions.push(`${boxes[i].id} / ${boxes[j].id}`);
      }
    }
    expect(collisions).toEqual([]);
  });

  it('stays close to square, which is what a viewport wants', () => {
    const { width, height } = layout.bounds;
    expect(width / height).toBeGreaterThan(0.6);
    expect(width / height).toBeLessThan(1.7);
  });

  it('is deterministic', () => {
    const again = layoutRadial(SPELL_TREE_GRAPH, SPELL_TREE_LAYOUT_OPTIONS);
    for (const [id, box] of layout.boxes) expect(again.boxes.get(id)).toEqual(box);
  });

  it('handles an empty graph and a lone root', () => {
    expect(layoutRadial([]).boxes.size).toBe(0);
    const lone = layoutRadial([{ id: 'only', lane: 'core' }], { spanLane: 'core' });
    expect(lone.boxes.get('only')).toBeDefined();
  });
});
