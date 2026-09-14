import { useCallback, useEffect, useRef, useState } from 'react';
import './scrollEdges.css';

/**
 * Whether a scroll container has content past its top or bottom edge.
 *
 * Archetypes own every scroll container in the game, and none of them said so.
 * On a phone the Detail list and the Detail pane are two stacked scrollers
 * with no scrollbar (suppressed on coarse pointers), no fade, and rows cut
 * exactly at the container edge - which reads as the end of the list rather
 * than as more of it. The audit measured content clipped this way on
 * Companions and Party at six viewports, and the Gear buy control hidden
 * entirely on every phone.
 *
 * A fade that is always on is its own lie - it says "more below" under a list
 * of three - so this reports the two edges and the stylesheet draws only the
 * ones that are real.
 *
 * Both observers are needed and for different reasons: the box can change size
 * while the content does not (a rotation, the keyboard opening), and the
 * content can change height while the box does not (a filtered list, a
 * companion pulled). Polling would catch both and cost a layout read on every
 * frame of a game that publishes at 10Hz.
 */
export interface ScrollEdges {
  /** Attach to the scrolling element itself. */
  ref: React.RefObject<HTMLDivElement | null>;
  /** Attach to the element that grows inside it, when there is one. */
  contentRef: React.RefObject<HTMLDivElement | null>;
  atTop: boolean;
  atBottom: boolean;
}

export function useScrollEdges(): ScrollEdges {
  const ref = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ atTop: true, atBottom: true });

  const measure = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    // A pixel of tolerance: fractional layout means an exactly-scrolled
    // container reports a remainder of 0.5 and would flicker a fade forever.
    const atTop = element.scrollTop <= 1;
    const atBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 1;
    setEdges((previous) =>
      previous.atTop === atTop && previous.atBottom === atBottom ? previous : { atTop, atBottom },
    );
  }, []);

  /*
   * After every render, because that is when the content most often changed:
   * a different companion selected, a row filtered out, a section appearing.
   * Three layout reads at the publish rate is nothing next to the frame the
   * scene is drawing, and it means a scroller is never a render behind the
   * truth about itself.
   */
  useEffect(measure);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    measure();
    element.addEventListener('scroll', measure, { passive: true });

    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    if (contentRef.current) observer?.observe(contentRef.current);

    return () => {
      element.removeEventListener('scroll', measure);
      observer?.disconnect();
    };
  }, [measure]);

  return { ref, contentRef, atTop: edges.atTop, atBottom: edges.atBottom };
}

/**
 * The attributes a scroll container hands its stylesheet. Written as data
 * attributes rather than classes so the rule reads as a fact about the box
 * rather than as a name someone chose.
 */
export function scrollEdgeAttributes(edges: ScrollEdges): Record<string, string | undefined> {
  return {
    'data-scroll-above': edges.atTop ? undefined : 'true',
    'data-scroll-below': edges.atBottom ? undefined : 'true',
  };
}
