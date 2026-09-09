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
 * A radial layer layout: the root at the centre, each rank a ring outward, and
 * each lane its own wedge of the circle.
 *
 * It produces the same GraphLayout as the layered version, so the Graph
 * archetype renders it without knowing which one it was handed.
 *
 * Ring radii are derived, not chosen. A ring has to be far enough out that the
 * widest lane's nodes fit around its arc, so the layout sizes itself to the
 * data instead of being tuned per tree.
 */
export interface RadialOptions {
  nodeWidth?: number;
  nodeHeight?: number;
  /** Minimum gap between neighbours along a ring. */
  gap?: number;
  /** Smallest distance from the centre to the first ring. */
  minRingRadius?: number;
  /** Blank angle left between adjacent lanes, in radians. */
  laneGapAngle?: number;
  /** Where the first lane starts. -PI/2 puts it at the top. */
  startAngle?: number;
  /** Nodes in this lane sit at the centre instead of on a ring. */
  spanLane?: string;
}

const DEFAULTS = {
  nodeWidth: 132,
  nodeHeight: 46,
  gap: 26,
  minRingRadius: 170,
  laneGapAngle: 0.22,
  startAngle: -Math.PI / 2,
};

export function layoutRadial(
  nodes: readonly GraphNodeInput[],
  options: RadialOptions = {},
): GraphLayout {
  const opts = { ...DEFAULTS, ...options };
  if (nodes.length === 0) {
    return { boxes: new Map(), edges: [], bounds: { x: 0, y: 0, width: 0, height: 0 }, lanes: [], rankCount: 0 };
  }

  const ranks = rankNodes(nodes);
  const laneOf = (node: GraphNodeInput) => node.lane ?? 'default';
  const isSpan = (node: GraphNodeInput) =>
    options.spanLane !== undefined && laneOf(node) === options.spanLane;

  const lanes: string[] = [];
  for (const node of nodes) {
    const lane = laneOf(node);
    if (!isSpan(node) && !lanes.includes(lane)) lanes.push(lane);
  }
  if (lanes.length === 0) lanes.push('default');

  const widthOf = (node: GraphNodeInput) => node.width ?? opts.nodeWidth;
  const heightOf = (node: GraphNodeInput) => node.height ?? opts.nodeHeight;

  const rankCount = Math.max(...[...ranks.values()]) + 1;
  const byRankLane = new Map<string, GraphNodeInput[]>();
  const key = (rank: number, lane: string) => `${rank}|${lane}`;
  for (const node of nodes) {
    if (isSpan(node)) continue;
    const k = key(ranks.get(node.id) ?? 0, laneOf(node));
    const list = byRankLane.get(k);
    if (list) list.push(node);
    else byRankLane.set(k, [node]);
  }

  // Each lane owns an equal wedge, minus the gap that separates it from its
  // neighbours.
  const wedge = (Math.PI * 2) / lanes.length;
  const usable = Math.max(0.2, wedge - opts.laneGapAngle);

  // A ring must be large enough that the busiest lane's nodes fit along its
  // arc, and never smaller than the ring inside it.
  const radii: number[] = [];
  let previous = 0;
  let previousHalfDiagonal = 0;
  for (let rank = 0; rank < rankCount; rank += 1) {
    let needed = opts.minRingRadius;
    let halfDiagonal = 0;
    for (const lane of lanes) {
      const row = byRankLane.get(key(rank, lane)) ?? [];
      if (row.length === 0) continue;
      const span = row.reduce((sum, node) => sum + widthOf(node), 0) + (row.length - 1) * opts.gap;
      needed = Math.max(needed, span / usable);
      for (const node of row) {
        halfDiagonal = Math.max(halfDiagonal, Math.hypot(widthOf(node), heightOf(node)) / 2);
      }
    }
    // Neighbouring rings are separated by the boxes' half-diagonals, not their
    // heights: a node on a ring sits at an angle, so its axis-aligned box
    // reaches further than its height suggests.
    const clearance = previousHalfDiagonal + halfDiagonal + opts.gap;
    const radius = Math.max(needed, previous + clearance);
    radii.push(rank === 0 ? 0 : radius);
    previous = rank === 0 ? halfDiagonal : radius;
    previousHalfDiagonal = halfDiagonal;
  }

  const boxes = new Map<string, GraphBox>();

  for (const node of nodes) {
    if (!isSpan(node)) continue;
    boxes.set(node.id, {
      id: node.id,
      rank: ranks.get(node.id) ?? 0,
      lane: laneOf(node),
      x: -widthOf(node) / 2,
      y: -heightOf(node) / 2,
      width: widthOf(node),
      height: heightOf(node),
    });
  }

  lanes.forEach((lane, laneIndex) => {
    const laneStart = opts.startAngle + laneIndex * wedge + opts.laneGapAngle / 2;

    for (let rank = 0; rank < rankCount; rank += 1) {
      const row = byRankLane.get(key(rank, lane)) ?? [];
      if (row.length === 0) continue;

      const radius = radii[rank];
      // Sort by declaration so the ring order is stable run to run.
      row.sort((a, b) => nodes.indexOf(a) - nodes.indexOf(b));

      row.forEach((node, index) => {
        // Spread across the wedge, centred within it.
        const step = row.length === 1 ? 0 : usable / (row.length - 1);
        const angle =
          row.length === 1 ? laneStart + usable / 2 : laneStart + index * step;
        const centreX = Math.cos(angle) * radius;
        const centreY = Math.sin(angle) * radius;
        boxes.set(node.id, {
          id: node.id,
          rank,
          lane,
          x: centreX - widthOf(node) / 2,
          y: centreY - heightOf(node) / 2,
          width: widthOf(node),
          height: heightOf(node),
        });
      });
    }
  });

  const edges: GraphEdge[] = [];
  for (const node of nodes) {
    for (const parent of node.requires ?? []) edges.push({ from: parent, to: node.id });
  }

  const bounds: Rect = boundsOf(boxes.values());
  return { boxes, edges, bounds, lanes, rankCount };
}
