import { useMemo } from 'react';
import { toScreen } from '../graph/fitView';
import { shouldShowMinimap } from '../graph/fitView';
import type { GraphBox, GraphLayout } from '../graph/layoutGraph';
import { useGraphViewport } from '../graph/useGraphViewport';
import styles from './Graph.module.css';

/**
 * Archetype 3 of 5. Nodes and prerequisites, laid out from the data, fitted to
 * the frame by default. The spell tree, all eight gear trees and anything
 * tree-shaped added later are this component with different data.
 *
 * Affordances arrive by need rather than by feature: the minimap appears only
 * once the graph outgrows its frame by enough to be worth the pixels.
 */
export type EdgeTone = 'active' | 'reachable' | 'idle';

/** What a node is being drawn at, so a surface can decide what is legible. */
export interface GraphView {
  scale: number;
  /**
   * The largest hit area a node may claim without stealing its neighbour's
   * taps, in screen pixels. Grows with the zoom and stops at --touch-target.
   */
  hitArea: number;
}

interface GraphProps {
  layout: GraphLayout;
  renderNode: (box: GraphBox, view: GraphView) => React.ReactNode;
  edgeTone: (from: string, to: string) => EdgeTone;
  nodeTone?: (id: string) => string;
  /**
   * A layered graph reads best with edges leaving the bottom of a node and
   * arriving at the top of the next. A radial one has no top or bottom, so its
   * edges run centre to centre.
   */
  edgeAnchor?: 'stack' | 'centre';
  toolbar?: React.ReactNode;
  inspector?: React.ReactNode;
  /** Called with a node box when something asks to centre on it. */
  focusRef?: (focus: (box: GraphBox) => void) => void;
}

/**
 * `--touch-target` in a number, because this arithmetic happens in JS. Kept
 * beside the one place that uses it rather than duplicated into a token
 * lookup; the sheet is still the authority for everything CSS draws.
 */
const TOUCH_TARGET = 44;

/**
 * The shortest centre-to-centre distance between any two nodes in the layout.
 *
 * O(n^2) over 127 nodes, run once per layout - the spell tree's is a module
 * constant, so this is a single pass for the life of the tab.
 */
function closestNeighbour(layout: GraphLayout): number {
  const centres = [...layout.boxes.values()].map((box) => ({
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  }));
  let shortest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < centres.length; i += 1) {
    for (let j = i + 1; j < centres.length; j += 1) {
      const a = centres[i]!;
      const b = centres[j]!;
      shortest = Math.min(shortest, Math.hypot(a.x - b.x, a.y - b.y));
    }
  }
  return Number.isFinite(shortest) ? shortest : TOUCH_TARGET;
}

const EDGE_STROKE: Record<EdgeTone, { stroke: string; width: number }> = {
  active: { stroke: 'var(--accent)', width: 2.6 },
  reachable: { stroke: 'color-mix(in srgb, var(--route) 55%, transparent)', width: 2 },
  idle: { stroke: 'var(--line)', width: 1.6 },
};

export function Graph({
  layout,
  renderNode,
  edgeTone,
  nodeTone,
  edgeAnchor = 'stack',
  toolbar,
  inspector,
  focusRef,
}: GraphProps) {
  const { bounds } = layout;
  const view = useGraphViewport(bounds);
  focusRef?.(view.focus);

  const showMinimap = shouldShowMinimap(bounds, view.viewport, view.transform.scale);
  const zoomPercent = Math.round(view.transform.scale * 100);

  /*
   * A node is drawn at its authored size times the zoom, so the spell tree's
   * 26px `minor` nodes measured 6-12px on screen at every viewport and not one
   * node anywhere reached the 44px the rest of the shell respects.
   *
   * Handing every node a flat 44px hit area would be worse rather than better:
   * at the fitted zoom the rings are ~15px apart, so the targets would overlap
   * three deep and a tap would land on an arbitrary node. The cap is therefore
   * the distance to the closest neighbour anywhere in the layout - the target
   * grows as the player zooms in and stops the moment it would start stealing
   * taps. Measured once; the layout is a module constant.
   */
  const closest = useMemo(() => closestNeighbour(layout), [layout]);
  const graphView: GraphView = {
    scale: view.transform.scale,
    hitArea: Math.min(TOUCH_TARGET, closest * view.transform.scale),
  };

  return (
    <div className={styles.graph}>
      <div className={styles.main}>
        {toolbar && <div className={styles.toolbar}>{toolbar}</div>}
        <div
          ref={view.containerRef}
          className={view.isDragging ? `${styles.viewport} ${styles.dragging}` : styles.viewport}
        >
          <div
            className={styles.canvas}
            style={{
              width: bounds.width,
              height: bounds.height,
              transform: `translate(${view.transform.x + bounds.x * view.transform.scale}px, ${
                view.transform.y + bounds.y * view.transform.scale
              }px) scale(${view.transform.scale})`,
              // World units per screen pixel, so a node can size a hit area in
              // screen terms from inside a scaled layer.
              '--graph-inverse-scale': 1 / Math.max(view.transform.scale, 1e-6),
              '--graph-hit-area': `${graphView.hitArea}px`,
            } as React.CSSProperties}
          >
            <svg
              className={styles.edges}
              width={bounds.width}
              height={bounds.height}
              aria-hidden="true"
            >
              {layout.edges.map((edge) => {
                const from = layout.boxes.get(edge.from);
                const to = layout.boxes.get(edge.to);
                if (!from || !to) return null;
                const tone = EDGE_STROKE[edgeTone(edge.from, edge.to)];
                const radial = edgeAnchor === 'centre';
                const x1 = from.x - bounds.x + from.width / 2;
                const y1 = from.y - bounds.y + (radial ? from.height / 2 : from.height);
                const x2 = to.x - bounds.x + to.width / 2;
                const y2 = to.y - bounds.y + (radial ? to.height / 2 : 0);

                if (!radial) {
                  return (
                    <line
                      key={`${edge.from}->${edge.to}`}
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke={tone.stroke}
                      strokeWidth={tone.width}
                      strokeLinecap="round"
                    />
                  );
                }

                // Bow toward the middle. Straight spokes between rings cross each
                // other and read as a web; a curve that leans inward reads as a
                // branch leaving its parent.
                const originX = -bounds.x;
                const originY = -bounds.y;
                const midX = (x1 + x2) / 2;
                const midY = (y1 + y2) / 2;
                const controlX = midX + (originX - midX) * 0.22;
                const controlY = midY + (originY - midY) * 0.22;
                return (
                  <path
                    key={`${edge.from}->${edge.to}`}
                    d={`M ${x1} ${y1} Q ${controlX} ${controlY} ${x2} ${y2}`}
                    fill="none"
                    stroke={tone.stroke}
                    strokeWidth={tone.width}
                    strokeLinecap="round"
                  />
                );
              })}
            </svg>

            {[...layout.boxes.values()].map((box) => (
              <div
                key={box.id}
                className={styles.node}
                style={{
                  left: box.x - bounds.x,
                  top: box.y - bounds.y,
                  width: box.width,
                  height: box.height,
                }}
              >
                {renderNode(box, graphView)}
              </div>
            ))}
          </div>

          {showMinimap && (
            <div className={styles.minimap} aria-hidden="true">
              {[...layout.boxes.values()].map((box) => (
                <span
                  key={box.id}
                  className={styles.minimapDot}
                  style={{
                    left: `${((box.x + box.width / 2 - bounds.x) / bounds.width) * 100}%`,
                    top: `${((box.y + box.height / 2 - bounds.y) / bounds.height) * 100}%`,
                    background: nodeTone?.(box.id) ?? 'var(--ink-dim)',
                  }}
                />
              ))}
              <span
                className={styles.minimapWindow}
                style={minimapWindowStyle(view.transform, view.viewport, bounds)}
              />
            </div>
          )}

          <div className={styles.controls}>
            <button
              type="button"
              className={styles.control}
              onClick={() => view.zoomBy(1 / 1.25)}
              aria-label="Zoom out"
            >
              &minus;
            </button>
            <span className={styles.zoomLevel}>{zoomPercent}%</span>
            <button
              type="button"
              className={styles.control}
              onClick={() => view.zoomBy(1.25)}
              aria-label="Zoom in"
            >
              +
            </button>
            <button
              type="button"
              className={`${styles.control} ${styles.fit}`}
              onClick={view.fit}
            >
              Fit
            </button>
          </div>
        </div>
      </div>

      {inspector && <aside className={styles.inspector}>{inspector}</aside>}
    </div>
  );
}

/** Where the visible frame sits over the whole graph, in minimap percentages. */
function minimapWindowStyle(
  transform: { scale: number; x: number; y: number },
  viewport: { width: number; height: number },
  bounds: { x: number; y: number; width: number; height: number },
): React.CSSProperties {
  const topLeft = {
    x: (-transform.x / transform.scale - bounds.x) / bounds.width,
    y: (-transform.y / transform.scale - bounds.y) / bounds.height,
  };
  const size = {
    width: viewport.width / transform.scale / bounds.width,
    height: viewport.height / transform.scale / bounds.height,
  };
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  return {
    left: `${clamp(topLeft.x) * 100}%`,
    top: `${clamp(topLeft.y) * 100}%`,
    width: `${clamp(size.width) * 100}%`,
    height: `${clamp(size.height) * 100}%`,
  };
}

export { toScreen };
