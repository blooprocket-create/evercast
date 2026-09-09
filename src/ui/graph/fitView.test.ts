import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCALE_LIMITS,
  type Rect,
  type Size,
  clampPan,
  fitToBounds,
  focusOn,
  overflowRatio,
  shouldShowMinimap,
  shouldShowSearch,
  toScreen,
  toWorld,
  zoomAt,
} from './fitView';

const VIEWPORT: Size = { width: 800, height: 600 };
const BOUNDS: Rect = { x: 0, y: 0, width: 1600, height: 900 };
const OFFSET_BOUNDS: Rect = { x: -200, y: 50, width: 1600, height: 900 };

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('fitToBounds', () => {
  it('fits the limiting axis inside the padding', () => {
    const t = fitToBounds(BOUNDS, VIEWPORT, 24);
    // Width is limiting: (800 - 48) / 1600.
    near(t.scale, 752 / 1600);
    expect(BOUNDS.width * t.scale).toBeLessThanOrEqual(VIEWPORT.width - 48 + 1e-6);
    expect(BOUNDS.height * t.scale).toBeLessThanOrEqual(VIEWPORT.height - 48 + 1e-6);
  });

  it('centres the graph, including when bounds do not start at the origin', () => {
    for (const bounds of [BOUNDS, OFFSET_BOUNDS]) {
      const t = fitToBounds(bounds, VIEWPORT, 24);
      const topLeft = toScreen(t, { x: bounds.x, y: bounds.y });
      const bottomRight = toScreen(t, {
        x: bounds.x + bounds.width,
        y: bounds.y + bounds.height,
      });
      near(topLeft.x, VIEWPORT.width - bottomRight.x);
      near(topLeft.y, VIEWPORT.height - bottomRight.y);
    }
  });

  it('respects the scale limits rather than magnifying a tiny graph forever', () => {
    const tiny = fitToBounds({ x: 0, y: 0, width: 10, height: 10 }, VIEWPORT, 24);
    expect(tiny.scale).toBe(DEFAULT_SCALE_LIMITS.max);
    const huge = fitToBounds({ x: 0, y: 0, width: 1e6, height: 1e6 }, VIEWPORT, 24);
    expect(huge.scale).toBe(DEFAULT_SCALE_LIMITS.min);
  });

  it('survives a degenerate single-node graph', () => {
    const t = fitToBounds({ x: 5, y: 5, width: 0, height: 0 }, VIEWPORT, 24);
    expect(Number.isFinite(t.scale)).toBe(true);
    expect(Number.isFinite(t.x)).toBe(true);
    expect(Number.isFinite(t.y)).toBe(true);
  });
});

describe('zoomAt', () => {
  it('holds the point under the cursor exactly fixed', () => {
    const start = fitToBounds(BOUNDS, VIEWPORT, 24);
    const pointer = { x: 613, y: 217 };
    const before = toWorld(start, pointer);
    for (const factor of [1.2, 0.8, 3, 0.1]) {
      const after = toWorld(zoomAt(start, factor, pointer), pointer);
      near(after.x, before.x);
      near(after.y, before.y);
    }
  });

  it('clamps scale without losing the anchor', () => {
    const start = { scale: 2.4, x: 0, y: 0 };
    const pointer = { x: 100, y: 100 };
    const zoomed = zoomAt(start, 10, pointer);
    expect(zoomed.scale).toBe(DEFAULT_SCALE_LIMITS.max);
    near(toWorld(zoomed, pointer).x, toWorld(start, pointer).x);
  });

  it('round-trips a zoom in and back out', () => {
    const start = fitToBounds(BOUNDS, VIEWPORT, 24);
    const pointer = { x: 400, y: 300 };
    const there = zoomAt(start, 1.5, pointer);
    const back = zoomAt(there, 1 / 1.5, pointer);
    near(back.scale, start.scale);
    near(back.x, start.x);
    near(back.y, start.y);
  });
});

describe('clampPan', () => {
  it('never lets an oversized graph be dragged off screen', () => {
    const scale = 1; // 1600x900 content in an 800x600 viewport
    for (const attempt of [-99999, 99999]) {
      const clamped = clampPan({ scale, x: attempt, y: attempt }, BOUNDS, VIEWPORT);
      const left = clamped.x;
      const right = clamped.x + BOUNDS.width * scale;
      expect(left).toBeLessThanOrEqual(0 + 1e-6);
      expect(right).toBeGreaterThanOrEqual(VIEWPORT.width - 1e-6);
    }
  });

  it('centres an axis that already fits instead of pinning it to a corner', () => {
    const scale = 0.25; // 400x225 content, smaller than the viewport both ways
    const clamped = clampPan({ scale, x: -5000, y: 4000 }, BOUNDS, VIEWPORT);
    near(clamped.x, (VIEWPORT.width - BOUNDS.width * scale) / 2);
    near(clamped.y, (VIEWPORT.height - BOUNDS.height * scale) / 2);
  });

  it('leaves a legal transform untouched', () => {
    const legal = { scale: 1, x: -400, y: -150 };
    expect(clampPan(legal, BOUNDS, VIEWPORT)).toEqual(legal);
  });

  it('accounts for bounds that do not start at the origin', () => {
    const scale = 1;
    const clamped = clampPan({ scale, x: 99999, y: 99999 }, OFFSET_BOUNDS, VIEWPORT);
    const left = toScreen(clamped, { x: OFFSET_BOUNDS.x, y: OFFSET_BOUNDS.y }).x;
    expect(left).toBeLessThanOrEqual(0 + 1e-6);
  });

  it('allows exactly the overscroll it is given', () => {
    const clamped = clampPan({ scale: 1, x: 99999, y: 0 }, BOUNDS, VIEWPORT, 40);
    near(clamped.x, 40);
  });
});

describe('focusOn', () => {
  it('centres the requested node', () => {
    const box = { x: 900, y: 700, width: 120, height: 40 };
    const t = focusOn(box, VIEWPORT, 1.25);
    const centre = toScreen(t, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    near(centre.x, VIEWPORT.width / 2);
    near(centre.y, VIEWPORT.height / 2);
  });
});

describe('affordances by need', () => {
  it('measures overflow as viewports of area', () => {
    // 1600x900 at scale 1 inside 800x600 is exactly three viewports.
    near(overflowRatio(BOUNDS, VIEWPORT, 1), 3);
    expect(overflowRatio(BOUNDS, VIEWPORT, fitToBounds(BOUNDS, VIEWPORT).scale)).toBeLessThan(1);
  });

  it('hides the minimap while the graph is fitted and shows it once zoomed in', () => {
    expect(shouldShowMinimap(BOUNDS, VIEWPORT, fitToBounds(BOUNDS, VIEWPORT).scale)).toBe(false);
    expect(shouldShowMinimap(BOUNDS, VIEWPORT, 1)).toBe(false);
    expect(shouldShowMinimap(BOUNDS, VIEWPORT, 1.5)).toBe(true);
  });

  it('shows the minimap on a phone-sized frame at the same scale', () => {
    const phone: Size = { width: 360, height: 520 };
    expect(shouldShowMinimap(BOUNDS, phone, 1)).toBe(true);
  });

  it('turns search on for the real spell tree but not for a small graph', () => {
    expect(shouldShowSearch(67)).toBe(true);
    expect(shouldShowSearch(12)).toBe(false);
  });
});
