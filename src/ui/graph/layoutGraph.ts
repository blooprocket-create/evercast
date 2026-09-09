import type { Rect } from './fitView';

/**
 * Layered layout computed from a prerequisite graph. Coordinates are derived,
 * never authored — which is what lets one Graph archetype serve the spell tree,
 * all eight gear trees, and whatever is added after them.
 *
 * Geometry lives in the UI layer by design; `src/engine/architecture.test.ts`
 * fails the build if x/y appear in engine types or authored content.
 */

export interface GraphNodeInput {
  id: string;
  /** Prerequisite ids. A node with none is a root. */
  requires?: readonly string[];
  /** Nodes sharing a lane are packed into the same vertical column of the graph. */
  lane?: string;
  width?: number;
  height?: number;
  /**
   * Pushes a node further down than its prerequisites demand. The honest
   * escape hatch for authored shape, and it belongs here rather than in
   * content, where the architecture test forbids coordinates outright.
   */
  rankBias?: number;
}

export interface LayoutOptions {
  nodeWidth?: number;
  nodeHeight?: number;
  gapX?: number;
  gapY?: number;
  laneGap?: number;
  /**
   * A rank with many siblings wraps into several rows rather than growing
   * sideways forever. Without this the authored spell tree lays out as a
   * 3854x474 ribbon, because 27 nodes share a single rank.
   */
  maxPerRow?: number;
  /** Nodes in this lane centre across every other lane instead of getting one. */
  spanLane?: string;
}

export interface GraphBox extends Rect {
  id: string;
  rank: number;
  lane: string;
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface GraphLayout {
  boxes: ReadonlyMap<string, GraphBox>;
  edges: readonly GraphEdge[];
  bounds: Rect;
  lanes: readonly string[];
  rankCount: number;
}

const DEFAULTS = {
  nodeWidth: 148,
  nodeHeight: 52,
  gapX: 18,
  gapY: 58,
  laneGap: 72,
  maxPerRow: 4,
};

function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

/** Longest path from any root, so a node always sits below every prerequisite. */
function rankNodes(nodes: readonly GraphNodeInput[]): Map<string, number> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const dependents = new Map<string, string[]>();
  const remaining = new Map<string, number>();

  for (const node of nodes) {
    const requires = node.requires ?? [];
    remaining.set(node.id, requires.length);
    for (const parent of requires) {
      if (!byId.has(parent)) {
        throw new Error(`Graph node "${node.id}" requires unknown node "${parent}".`);
      }
      const list = dependents.get(parent);
      if (list) list.push(node.id);
      else dependents.set(parent, [node.id]);
    }
  }

  const ranks = new Map<string, number>();
  const queue = nodes.filter((node) => (node.requires?.length ?? 0) === 0).map((node) => node.id);
  for (const id of queue) ranks.set(id, Math.max(0, byId.get(id)?.rankBias ?? 0));

  let cursor = 0;
  while (cursor < queue.length) {
    const id = queue[cursor];
    cursor += 1;
    for (const child of dependents.get(id) ?? []) {
      const bias = Math.max(0, byId.get(child)?.rankBias ?? 0);
      const candidate = (ranks.get(id) ?? 0) + 1 + bias;
      ranks.set(child, Math.max(ranks.get(child) ?? 0, candidate));
      const left = (remaining.get(child) ?? 0) - 1;
      remaining.set(child, left);
      if (left === 0) queue.push(child);
    }
  }

  if (ranks.size !== nodes.length) {
    const stuck = nodes.filter((node) => !ranks.has(node.id)).map((node) => node.id);
    throw new Error(`Graph has a prerequisite cycle involving: ${stuck.join(', ')}`);
  }
  return ranks;
}

export function layoutGraph(
  nodes: readonly GraphNodeInput[],
  options: LayoutOptions = {},
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

  const seen = new Set<string>();
  for (const node of nodes) {
    if (seen.has(node.id)) throw new Error(`Duplicate graph node id "${node.id}".`);
    seen.add(node.id);
  }

  const ranks = rankNodes(nodes);
  const declarationIndex = new Map(nodes.map((node, index) => [node.id, index]));
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

  // Lane widths depend only on how many nodes share a lane+rank, so they can be
  // settled before anything is positioned.
  const laneWidths = new Map<string, number>();
  for (const lane of lanes) {
    let widest = opts.nodeWidth;
    const byRank = new Map<number, GraphNodeInput[]>();
    for (const node of nodes) {
      if (isSpan(node) || laneOf(node) !== lane) continue;
      const rank = ranks.get(node.id) ?? 0;
      const list = byRank.get(rank);
      if (list) list.push(node);
      else byRank.set(rank, [node]);
    }
    for (const rankNodes of byRank.values()) {
      for (const row of chunk(rankNodes, opts.maxPerRow)) {
        const rowWidth =
          row.reduce((sum, node) => sum + widthOf(node), 0) + (row.length - 1) * opts.gapX;
        widest = Math.max(widest, rowWidth);
      }
    }
    laneWidths.set(lane, widest);
  }

  const laneCentres = new Map<string, number>();
  let cursorX = 0;
  for (const lane of lanes) {
    const width = laneWidths.get(lane) ?? opts.nodeWidth;
    laneCentres.set(lane, cursorX + width / 2);
    cursorX += width + opts.laneGap;
  }
  const spanCentre = (cursorX - opts.laneGap) / 2;

  const rankCount = Math.max(...[...ranks.values()]) + 1;
  const rowHeight = opts.nodeHeight + opts.gapY;
  const boxes = new Map<string, GraphBox>();
  let cursorY = 0;

  const barycentre = (node: GraphNodeInput): number | null => {
    const parents = (node.requires ?? [])
      .map((id) => boxes.get(id))
      .filter((box): box is GraphBox => box !== undefined);
    if (parents.length === 0) return null;
    return parents.reduce((sum, box) => sum + box.x + box.width / 2, 0) / parents.length;
  };

  // Ranks ascend, so every prerequisite is already placed when its children are.
  for (let rank = 0; rank < rankCount; rank += 1) {
    const atRank = nodes.filter((node) => ranks.get(node.id) === rank);
    const y = cursorY;
    let subRowsUsed = 1;

    for (const lane of lanes) {
      const inLane = atRank.filter((node) => !isSpan(node) && laneOf(node) === lane);
      if (inLane.length === 0) continue;

      inLane.sort((a, b) => {
        const byBarycentre = (barycentre(a) ?? 0) - (barycentre(b) ?? 0);
        if (Math.abs(byBarycentre) > 0.5) return byBarycentre;
        return (declarationIndex.get(a.id) ?? 0) - (declarationIndex.get(b.id) ?? 0);
      });

      const rows = chunk(inLane, opts.maxPerRow);
      subRowsUsed = Math.max(subRowsUsed, rows.length);

      rows.forEach((row, subRow) => {
        const rowWidth =
          row.reduce((sum, node) => sum + widthOf(node), 0) + (row.length - 1) * opts.gapX;
        let x = (laneCentres.get(lane) ?? 0) - rowWidth / 2;
        for (const node of row) {
          boxes.set(node.id, {
            id: node.id,
            rank,
            lane,
            x,
            y: y + subRow * rowHeight,
            width: widthOf(node),
            height: heightOf(node),
          });
          x += widthOf(node) + opts.gapX;
        }
      });
    }

    for (const node of atRank.filter(isSpan)) {
      const width = widthOf(node);
      boxes.set(node.id, {
        id: node.id,
        rank,
        lane: laneOf(node),
        x: (barycentre(node) ?? spanCentre) - width / 2,
        y,
        width,
        height: heightOf(node),
      });
    }

    cursorY += subRowsUsed * rowHeight;
  }

  const edges: GraphEdge[] = [];
  for (const node of nodes) {
    for (const parent of node.requires ?? []) edges.push({ from: parent, to: node.id });
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes.values()) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }

  return {
    boxes,
    edges,
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    lanes,
    rankCount,
  };
}
