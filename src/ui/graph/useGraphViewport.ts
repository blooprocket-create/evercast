import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  DEFAULT_SCALE_LIMITS,
  type Rect,
  type Size,
  type Transform,
  clampPan,
  fitToBounds,
  focusOn,
  zoomAt,
} from './fitView';

/**
 * A thin React wrapper over the pure maths in fitView. Fit-to-view is the
 * resting state; the user can zoom and pan, and one press of Fit returns.
 * Nothing here scrolls, so the two-axis scrollbar the old tree needed is gone.
 */
export interface GraphViewport {
  containerRef: React.RefObject<HTMLDivElement | null>;
  viewport: Size;
  transform: Transform;
  fit: () => void;
  zoomBy: (factor: number) => void;
  focus: (box: Rect) => void;
  isDragging: boolean;
}

const IDENTITY: Transform = { scale: 1, x: 0, y: 0 };

export function useGraphViewport(bounds: Rect): GraphViewport {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [transform, setTransform] = useState<Transform>(IDENTITY);
  const [isDragging, setDragging] = useState(false);
  const adjusted = useRef(false);

  // Live values for the native wheel listener, which must not re-attach on
  // every transform change.
  const latest = useRef({ transform, viewport, bounds });
  latest.current = { transform, viewport, bounds };

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setViewport({ width: box.width, height: box.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fit = useCallback(() => {
    const { viewport: size } = latest.current;
    if (size.width === 0 || size.height === 0) return;
    adjusted.current = false;
    setTransform(fitToBounds(latest.current.bounds, size));
  }, []);

  // Fit on first measure, and again on resize until the player takes control.
  useEffect(() => {
    if (viewport.width === 0 || viewport.height === 0) return;
    if (adjusted.current) return;
    setTransform(fitToBounds(bounds, viewport));
  }, [bounds, viewport]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const factor = Math.exp(-event.deltaY * 0.0015);
      adjusted.current = true;
      const { transform: current, bounds: box, viewport: size } = latest.current;
      setTransform(clampPan(zoomAt(current, factor, pointer), box, size, 80));
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  const zoomBy = useCallback((factor: number) => {
    const { transform: current, viewport: size, bounds: box } = latest.current;
    if (size.width === 0) return;
    adjusted.current = true;
    const centre = { x: size.width / 2, y: size.height / 2 };
    setTransform(clampPan(zoomAt(current, factor, centre, DEFAULT_SCALE_LIMITS), box, size, 80));
  }, []);

  const focus = useCallback((box: Rect) => {
    const { viewport: size, transform: current, bounds: outer } = latest.current;
    if (size.width === 0) return;
    adjusted.current = true;
    setTransform(clampPan(focusOn(box, size, current.scale), outer, size, 80));
  }, []);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    // Two pointers pinch, one pans. Tracked together so a second finger
    // landing mid-drag turns the gesture into a zoom rather than fighting it.
    const active = new Map<number, { x: number; y: number }>();
    let pinchDistance: number | null = null;
    let last = { x: 0, y: 0 };

    const spread = () => {
      const [a, b] = [...active.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const midpoint = () => {
      const [a, b] = [...active.values()];
      const rect = element.getBoundingClientRect();
      return { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top };
    };

    const onDown = (event: PointerEvent) => {
      // Let clicks on nodes and controls through.
      if ((event.target as HTMLElement).closest('button')) return;
      active.set(event.pointerId, { x: event.clientX, y: event.clientY });
      element.setPointerCapture(event.pointerId);
      if (active.size === 1) {
        last = { x: event.clientX, y: event.clientY };
        setDragging(true);
      } else if (active.size === 2) {
        pinchDistance = spread();
      }
    };

    const onMove = (event: PointerEvent) => {
      if (!active.has(event.pointerId)) return;
      active.set(event.pointerId, { x: event.clientX, y: event.clientY });
      adjusted.current = true;
      const { transform: current, bounds: box, viewport: size } = latest.current;

      if (active.size >= 2) {
        const distance = spread();
        if (pinchDistance && distance > 0) {
          const factor = distance / pinchDistance;
          pinchDistance = distance;
          setTransform(clampPan(zoomAt(current, factor, midpoint()), box, size, 80));
        }
        return;
      }

      const dx = event.clientX - last.x;
      const dy = event.clientY - last.y;
      last = { x: event.clientX, y: event.clientY };
      setTransform(
        clampPan({ ...current, x: current.x + dx, y: current.y + dy }, box, size, 80),
      );
    };

    const onUp = (event: PointerEvent) => {
      active.delete(event.pointerId);
      if (active.size < 2) pinchDistance = null;
      if (active.size === 1) {
        const [only] = [...active.values()];
        last = { x: only.x, y: only.y };
      }
      if (active.size === 0) setDragging(false);
    };

    element.addEventListener('pointerdown', onDown);
    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerup', onUp);
    element.addEventListener('pointercancel', onUp);
    return () => {
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp);
      element.removeEventListener('pointercancel', onUp);
    };
  }, []);

  return { containerRef, viewport, transform, fit, zoomBy, focus, isDragging };
}
