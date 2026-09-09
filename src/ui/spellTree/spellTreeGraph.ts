import { SPELL_TREE_NODES } from '../../content/spellTree';
import type { SpellTreeNodeKind } from '../../engine/spellTree/types';
import { type GraphNodeInput, type LayoutOptions, layoutGraph } from '../graph/layoutGraph';

/**
 * Adapts the authored spell tree to the generic graph layout. Everything
 * presentational — box sizes, which lane a region occupies — lives here, so
 * `src/content/spellTree.ts` stays free of geometry.
 */

const SIZE: Record<SpellTreeNodeKind, { width: number; height: number }> = {
  root: { width: 156, height: 54 },
  route: { width: 152, height: 52 },
  identity: { width: 140, height: 48 },
  minor: { width: 108, height: 38 },
  mutation: { width: 132, height: 46 },
  fusion: { width: 150, height: 50 },
};

export const SPELL_TREE_GRAPH: GraphNodeInput[] = SPELL_TREE_NODES.map((node) => ({
  id: node.id,
  requires: node.requiresAll,
  lane: node.region,
  ...SIZE[node.kind],
}));

export const SPELL_TREE_LAYOUT_OPTIONS: LayoutOptions = {
  spanLane: 'core',
  gapX: 16,
  gapY: 54,
  laneGap: 88,
};

export const SPELL_TREE_LAYOUT = layoutGraph(SPELL_TREE_GRAPH, SPELL_TREE_LAYOUT_OPTIONS);
