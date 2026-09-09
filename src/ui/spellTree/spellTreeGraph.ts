import { SPELL_TREE_NODES } from '../../content/spellTree';
import type { SpellTreeNodeKind } from '../../engine/spellTree/types';
import type { GraphNodeInput } from '../graph/layoutGraph';
import { type RadialOptions, layoutRadial } from '../graph/layoutRadial';

/**
 * Adapts the authored spell tree to the generic graph layout. Everything
 * presentational — box sizes, which lane a region occupies — lives here, so
 * `src/content/spellTree.ts` stays free of geometry.
 */

const SIZE: Record<SpellTreeNodeKind, { width: number; height: number }> = {
  root: { width: 132, height: 46 },
  route: { width: 124, height: 44 },
  identity: { width: 116, height: 40 },
  minor: { width: 96, height: 34 },
  mutation: { width: 112, height: 40 },
  fusion: { width: 124, height: 42 },
};

export const SPELL_TREE_GRAPH: GraphNodeInput[] = SPELL_TREE_NODES.map((node) => ({
  id: node.id,
  requires: node.requiresAll,
  lane: node.region,
  ...SIZE[node.kind],
}));

/**
 * One spell radiating outward from the Evercast, with a wedge per route. The
 * layered version reads as an org chart; the tree is about a single spell
 * growing, and a radial layout says that.
 */
export const SPELL_TREE_LAYOUT_OPTIONS: RadialOptions = {
  spanLane: 'core',
  gap: 22,
  minRingRadius: 190,
  // Wide enough that the three routes read as three arms, and wide enough
  // that neighbouring wedges cannot collide on a shared ring.
  laneGapAngle: 0.58,
  startAngle: -Math.PI / 2,
};

export const SPELL_TREE_LAYOUT = layoutRadial(SPELL_TREE_GRAPH, SPELL_TREE_LAYOUT_OPTIONS);
