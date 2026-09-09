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

interface GraphProps {
  layout: GraphLayout;
  renderNode: (box: GraphBox) => React.ReactNode;
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
            }}
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
                {renderNode(box)}
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
