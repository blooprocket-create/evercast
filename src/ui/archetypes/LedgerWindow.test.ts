import { describe, expect, it } from 'vitest';
import { VIRTUALIZE_ABOVE, ledgerWindow, shouldVirtualize } from './LedgerWindow';

const base = { viewportHeight: 520, rowHeight: 52, overscan: 4 };

describe('ledgerWindow', () => {
  it('always covers the visible rows', () => {
    const count = 5000;
    for (const scrollTop of [0, 51, 52, 999, 12_345, 259_000]) {
      const w = ledgerWindow({ ...base, scrollTop, count });
      const firstVisible = Math.floor(
        Math.min(scrollTop, count * base.rowHeight - base.viewportHeight) / base.rowHeight,
      );
      const lastVisible = Math.min(
        count - 1,
        Math.floor(
          (Math.min(scrollTop, count * base.rowHeight - base.viewportHeight) +
            base.viewportHeight) /
            base.rowHeight,
        ),
      );
      expect(w.start).toBeLessThanOrEqual(firstVisible);
      expect(w.end).toBeGreaterThan(lastVisible);
    }
  });

  it('keeps padding plus rendered rows equal to the full list height', () => {
    for (const scrollTop of [0, 400, 9_000, 100_000]) {
      const w = ledgerWindow({ ...base, scrollTop, count: 5000 });
      const rendered = (w.end - w.start) * base.rowHeight;
      expect(w.padTop + rendered + w.padBottom).toBe(w.totalHeight);
      expect(w.totalHeight).toBe(5000 * base.rowHeight);
    }
  });

  it('never produces a negative or inverted window', () => {
    for (const scrollTop of [-500, 0, 1e9]) {
      for (const count of [0, 1, 8, 240]) {
        const w = ledgerWindow({ ...base, scrollTop, count });
        expect(w.start).toBeGreaterThanOrEqual(0);
        expect(w.end).toBeGreaterThanOrEqual(w.start);
        expect(w.end).toBeLessThanOrEqual(count);
        expect(w.padTop).toBeGreaterThanOrEqual(0);
        expect(w.padBottom).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('renders everything when the list is shorter than the viewport', () => {
    const w = ledgerWindow({ ...base, scrollTop: 0, count: 8 });
    expect(w).toEqual({ start: 0, end: 8, padTop: 0, padBottom: 0, totalHeight: 416 });
  });

  it('handles an empty list and a zero row height without dividing by zero', () => {
    expect(ledgerWindow({ ...base, scrollTop: 0, count: 0 })).toEqual({
      start: 0,
      end: 0,
      padTop: 0,
      padBottom: 0,
      totalHeight: 0,
    });
    const degenerate = ledgerWindow({ ...base, rowHeight: 0, scrollTop: 10, count: 12 });
    expect(degenerate.start).toBe(0);
    expect(degenerate.end).toBe(12);
  });

  it('clamps a scroll past the end back onto the last page', () => {
    const w = ledgerWindow({ ...base, scrollTop: 1e9, count: 240 });
    expect(w.end).toBe(240);
    expect(w.padBottom).toBe(0);
  });

  it('only bothers virtualizing once a list is genuinely long', () => {
    expect(shouldVirtualize(8)).toBe(false);
    expect(shouldVirtualize(VIRTUALIZE_ABOVE)).toBe(false);
    expect(shouldVirtualize(240)).toBe(true);
  });
});
