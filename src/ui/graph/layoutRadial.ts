import type { Rect } from './fitView';
import {
  type GraphBox,
  type GraphEdge,
  type GraphLayout,
  type GraphNodeInput,
  boundsOf,
  rankNodes,
} from './layoutGraph';

/**
 * A radial tidy tree: the root at the centre, depth measured outward, and every
 * node given a slice of angle sized by how much of the tree hangs beneath it.
 *
 * The slice is the whole idea. Spreading each rank evenly around a ring - the
 * obvious way to go radial - scatters siblings away from their parent and the
 * result reads as a web of crossing threads. Giving a node its own wedge and
 * dividing it among its children keeps a branch together, so the picture is
 * branches rather than spokes.
 *
 * Rings are sized by what has to fit on them: a node needs `radius * arc` to be
 * at least as wide as it is, so a crowded depth pushes its ring outward. The
 * layout sizes itself to the data rather than being tuned per tree.
 */
export interface RadialOptions {
  nodeWidth?: number;
  nodeHeight?: number;
  /** Minimum arc between neighbours, in world units. */
  gap?: number;
  /** Smallest step between consecutive rings. */
  ringSpacing?: number;
  /** Distance from the centre to the first ring. */
  firstRingRadius?: number;
  /** Where the sweep begins. -PI/2 starts at the top. */
  startAngle?: number;
  /**
   * How much of the circle to use. Less than a full turn leaves a mouth at the
   * start angle, which reads more deliberate than a closed ring.
   */
  sweep?: number;
  /** Nodes in this lane sit at the centre instead of on a ring. */
  spanLane?: string;
}

const DEFAULTS = {
  nodeWidth: 116,
  nodeHeight: 38,
  gap: 26,
  ringSpacing: 96,
  firstRingRadius: 190,
  startAngle: -Math.PI / 2,
  sweep: Math.PI * 1.86,
};

interface Slice {
  node: GraphNodeInput;
  depth: number;
  start: number;
  size: number;
}

export function layoutRadial(
  nodes: readonly GraphNodeInput[],
  options: RadialOptions = {},
): GraphLayout {
  const opts = { ...DEFAULTS, ...options };
  if (nodes.length === 0) {
    return {
      boxes: new Map(),
      edges: [],
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      lanes: [],
      rankCount: 0,
    };
  }

  const ranks = rankNodes(nodes);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const laneOf = (node: GraphNodeInput) => node.lane ?? 'default';
  const isSpan = (node: GraphNodeInput) =>
    options.spanLane !== undefined && laneOf(node) === options.spanLane;
  const widthOf = (node: GraphNodeInput) => node.width ?? opts.nodeWidth;
  const heightOf = (node: GraphNodeInput) => node.height ?? opts.nodeHeight;

  /**
   * A node can have several prerequisites - a fusion needs two mutations - but
   * a tidy tree needs one. The first is the spine; the rest are still drawn as
   * edges, they just do not decide where the node sits.
   */
  const spine = new Map<string, string[]>();
  const centres: GraphNodeInput[] = [];
  for (const node of nodes) {
    const parent = (node.requires ?? []).find((id) => byId.has(id));
    if (parent === undefined || isSpan(node)) {
      if (isSpan(node) || parent === undefined) centres.push(node);
      continue;
    }
    const list = spine.get(parent);
    if (list) list.push(node.id);
    else spine.set(parent, [node.id]);
  }

  /** How many leaves hang beneath a node; that is its share of the angle. */
  const weights = new Map<string, number>();
  const weigh = (id: string): number => {
    const cached = weights.get(id);
    if (cached !== undefined) return cached;
    weights.set(id, 1); // guards against a malformed cycle
    const children = spine.get(id) ?? [];
    const weight = children.length === 0 ? 1 : children.reduce((sum, c) => sum + weigh(c), 0);
    weights.set(id, weight);
    return weight;
  };
  for (const node of nodes) weigh(node.id);

  // Hand each node its wedge, then divide that wedge among its children.
  const slices: Slice[] = [];
  const assign = (id: string, depth: number, start: number, size: number) => {
    const node = byId.get(id);
    if (!node) return;
    slices.push({ node, depth, start, size });

    const children = spine.get(id) ?? [];
    if (children.length === 0) return;
    const total = children.reduce((sum, child) => sum + weigh(child), 0) || 1;
    let cursor = start;
    for (const child of children) {
      const share = (weigh(child) / total) * size;
      assign(child, depth + 1, cursor, share);
      cursor += share;
    }
  };

  const rootWeight = centres.reduce((sum, node) => sum + weigh(node.id), 0) || 1;
  let cursor = opts.startAngle;
  for (const centre of centres) {
    const share = (weigh(centre.id) / rootWeight) * opts.sweep;
    assign(centre.id, 0, cursor, share);
    cursor += share;
  }

  // A ring has to be wide enough that the narrowest wedge on it still fits its
  // node, and always further out than the ring inside it.
  const maxDepth = slices.reduce((deepest, slice) => Math.max(deepest, slice.depth), 0);

  /**
   * Half the diagonal, not half the height: a node sitting at an angle presents
   * an axis-aligned box that reaches further than its height suggests, so two
   * rings a node-height apart still collide.
   */
  const reachAt = (depth: number): number => {
    let reach = 0;
    for (const slice of slices) {
      if (slice.depth !== depth) continue;
      reach = Math.max(reach, Math.hypot(widthOf(slice.node), heightOf(slice.node)) / 2);
    }
    return reach;
  };

  const radii: number[] = [];
  for (let depth = 0; depth <= maxDepth; depth += 1) {
    if (depth === 0) {
      radii.push(0);
      continue;
    }
    let needed = opts.firstRingRadius;
    for (const slice of slices) {
      if (slice.depth !== depth || slice.size <= 0) continue;
      needed = Math.max(needed, (widthOf(slice.node) + opts.gap) / slice.size);
    }
    const clearance = Math.max(opts.ringSpacing, reachAt(depth - 1) + reachAt(depth) + opts.gap);
    radii.push(Math.max(needed, (radii[depth - 1] ?? 0) + clearance));
  }

  const boxes = new Map<string, GraphBox>();
  for (const slice of slices) {
    const radius = radii[slice.depth] ?? 0;
    const angle = slice.start + slice.size / 2;
    const centreX = Math.cos(angle) * radius;
    const centreY = Math.sin(angle) * radius;
    boxes.set(slice.node.id, {
      id: slice.node.id,
      // `rank` stays the prerequisite depth, which is what callers reason about.
      rank: ranks.get(slice.node.id) ?? slice.depth,
      lane: laneOf(slice.node),
      x: centreX - widthOf(slice.node) / 2,
      y: centreY - heightOf(slice.node) / 2,
      width: widthOf(slice.node),
      height: heightOf(slice.node),
    });
  }

  const edges: GraphEdge[] = [];
  for (const node of nodes) {
    for (const parent of node.requires ?? []) {
      if (byId.has(parent)) edges.push({ from: parent, to: node.id });
    }
  }

  const bounds: Rect = boundsOf(boxes.values());
  return {
    boxes,
    edges,
    bounds,
    lanes: [...new Set(nodes.filter((n) => !isSpan(n)).map(laneOf))],
    rankCount: Math.max(...[...ranks.values()]) + 1,
  };
}
