/**
 * Viewport maths for the Graph archetype. Pure numbers: no DOM, no React, no
 * engine. A screen point is `world * scale + translate`, so the graph is one
 * transformed layer inside an `overflow: hidden` box and never scrolls on two
 * axes the way the old spell-tree viewport did.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Transform {
  scale: number;
  x: number;
  y: number;
}

export interface ScaleLimits {
  min: number;
  max: number;
}

export const DEFAULT_SCALE_LIMITS: ScaleLimits = { min: 0.25, max: 2.5 };

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** World point currently under a point on screen. */
export function toWorld(transform: Transform, screen: Point): Point {
  return {
    x: (screen.x - transform.x) / transform.scale,
    y: (screen.y - transform.y) / transform.scale,
  };
}

/** Where a world point lands on screen. */
export function toScreen(transform: Transform, world: Point): Point {
  return {
    x: world.x * transform.scale + transform.x,
    y: world.y * transform.scale + transform.y,
  };
}

/**
 * The scale at which the whole graph fits inside the viewport, with padding.
 *
 * Bounded above but **not below**, and that is the fix rather than an
 * oversight. It used to clamp to `limits.min`, which is 0.25 - and the spell
 * tree's bounds are 1719x1846, so a 390x844 phone (a ~390x318 graph viewport)
 * needed 0.146 and got 0.25. The tree was drawn 430x461 inside a 390x318 box,
 * off the edge on all four sides, and `Fit` recomputed the same pinned
 * transform every time it was pressed. There was no gesture that showed the
 * whole graph.
 *
 * A floor still exists, at the point where the picture stops being a picture,
 * so a degenerate viewport cannot produce a zero or a negative scale.
 */
export const MIN_FIT_SCALE = 0.02;

export function fitScale(
  bounds: Rect,
  viewport: Size,
  padding = 24,
  limits: ScaleLimits = DEFAULT_SCALE_LIMITS,
): number {
  const usableWidth = Math.max(1, viewport.width - padding * 2);
  const usableHeight = Math.max(1, viewport.height - padding * 2);
  const needed = Math.min(
    usableWidth / Math.max(1, bounds.width),
    usableHeight / Math.max(1, bounds.height),
  );
  if (!Number.isFinite(needed)) return limits.max;
  // A fit may shrink as far as it must; it may never magnify past the ceiling.
  return Math.min(limits.max, Math.max(MIN_FIT_SCALE, needed));
}

/** The whole graph, centred, with padding. This is the default state. */
export function fitToBounds(
  bounds: Rect,
  viewport: Size,
  padding = 24,
  limits: ScaleLimits = DEFAULT_SCALE_LIMITS,
): Transform {
  const scale = fitScale(bounds, viewport, padding, limits);
  return {
    scale,
    x: (viewport.width - bounds.width * scale) / 2 - bounds.x * scale,
    y: (viewport.height - bounds.height * scale) / 2 - bounds.y * scale,
  };
}

/**
 * The zoom range the player may move through, given what the graph needs to
 * fit. Without the lower end following the fit, pressing zoom-out on a phone
 * jumped *in* - from the 0.146 the graph was fitted at to the 0.25 floor.
 */
export function scaleLimitsFor(
  bounds: Rect,
  viewport: Size,
  padding = 24,
  limits: ScaleLimits = DEFAULT_SCALE_LIMITS,
): ScaleLimits {
  return { min: Math.min(limits.min, fitScale(bounds, viewport, padding, limits)), max: limits.max };
}

/** Zoom about a screen point — whatever is under the cursor stays under it. */
export function zoomAt(
  transform: Transform,
  factor: number,
  pointer: Point,
  limits: ScaleLimits = DEFAULT_SCALE_LIMITS,
): Transform {
  const scale = clamp(transform.scale * factor, limits.min, limits.max);
  const anchor = toWorld(transform, pointer);
  return {
    scale,
    x: pointer.x - anchor.x * scale,
    y: pointer.y - anchor.y * scale,
  };
}

/**
 * Keeps the graph reachable: an axis smaller than the viewport is centred on
 * it, a larger one may not be dragged past its own edge (plus `overscroll`).
 */
export function clampPan(
  transform: Transform,
  bounds: Rect,
  viewport: Size,
  overscroll = 0,
): Transform {
  const axis = (
    boundsStart: number,
    boundsSize: number,
    viewportSize: number,
    translate: number,
  ): number => {
    const scaled = boundsSize * transform.scale;
    const origin = boundsStart * transform.scale;
    if (scaled <= viewportSize) return (viewportSize - scaled) / 2 - origin;
    const min = viewportSize - scaled - origin - overscroll;
    const max = -origin + overscroll;
    return clamp(translate, min, max);
  };

  return {
    scale: transform.scale,
    x: axis(bounds.x, bounds.width, viewport.width, transform.x),
    y: axis(bounds.y, bounds.height, viewport.height, transform.y),
  };
}

/** Centre one node — used by search results and route jumps. */
export function focusOn(box: Rect, viewport: Size, scale: number): Transform {
  return {
    scale,
    x: viewport.width / 2 - (box.x + box.width / 2) * scale,
    y: viewport.height / 2 - (box.y + box.height / 2) * scale,
  };
}

/** How many viewports' worth of area the graph currently covers. */
export function overflowRatio(bounds: Rect, viewport: Size, scale: number): number {
  const viewportArea = Math.max(1, viewport.width * viewport.height);
  return (bounds.width * scale * (bounds.height * scale)) / viewportArea;
}

/**
 * Affordances appear by need. A minimap is only worth its pixels once you can
 * see about a quarter of the graph or less — below that it is chrome telling
 * you what you can already see. True on a phone, false on a wide desktop.
 */
export const MINIMAP_THRESHOLD = 4;

export function shouldShowMinimap(bounds: Rect, viewport: Size, scale: number): boolean {
  return overflowRatio(bounds, viewport, scale) > MINIMAP_THRESHOLD;
}

/** Search stops being optional somewhere around here. */
export const SEARCH_THRESHOLD = 40;

export function shouldShowSearch(nodeCount: number): boolean {
  return nodeCount > SEARCH_THRESHOLD;
}
