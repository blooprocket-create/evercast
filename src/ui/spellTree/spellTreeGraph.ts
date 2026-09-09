import { SPELL_TREE_NODES } from '../../content/spellTree';
import type { SpellTreeNodeKind } from '../../engine/spellTree/types';
import type { GraphNodeInput } from '../graph/layoutGraph';
import { type RadialOptions, layoutRadial } from '../graph/layoutRadial';

/**
 * Adapts the authored spell tree to the generic graph layout. Everything
 * presentational — box sizes, which lane a region occupies — lives here, so
 * `src/content/spellTree.ts` stays free of geometry.
 */

/**
 * Circles rather than labelled boxes. Wide boxes forced the rings apart - a
 * ring has to be big enough for its widest node - so the tree sprawled and
 * every label ended up truncated anyway. A circle carries the state in its
 * fill, and the name goes underneath only where it earns the room.
 */
const SIZE: Record<SpellTreeNodeKind, { width: number; height: number }> = {
  root: { width: 72, height: 72 },
  route: { width: 60, height: 60 },
  identity: { width: 50, height: 50 },
  minor: { width: 26, height: 26 },
  mutation: { width: 44, height: 44 },
  fusion: { width: 48, height: 48 },
};

/** Kinds worth naming on the canvas; the rest are read in the inspector. */
export const LABELLED_KINDS = new Set<SpellTreeNodeKind>([
  'root',
  'route',
  'identity',
  'mutation',
  'fusion',
]);

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
  gap: 26,
  ringSpacing: 104,
  firstRingRadius: 132,
  // A full turn. Anything less pushes the picture off to one side, because the
  // mouth is empty but the bounds still have to contain it.
  sweep: Math.PI * 2,
  startAngle: -Math.PI / 2,
};

export const SPELL_TREE_LAYOUT = layoutRadial(SPELL_TREE_GRAPH, SPELL_TREE_LAYOUT_OPTIONS);
