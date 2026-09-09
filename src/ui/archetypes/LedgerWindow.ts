/**
 * Windowing maths for the Ledger archetype. Rows are a fixed height by
 * contract — that is what lets a list of 8 and a list of 240 cost the same to
 * render, and it is why the row's label truncates rather than wrapping.
 */

export interface LedgerWindowInput {
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  count: number;
  /** Rows rendered beyond the viewport so scrolling does not flash. */
  overscan?: number;
}

export interface LedgerWindow {
  /** First rendered row index, inclusive. */
  start: number;
  /** Last rendered row index, exclusive. */
  end: number;
  padTop: number;
  padBottom: number;
  totalHeight: number;
}

/** Below this, rendering the whole list is cheaper than the bookkeeping. */
export const VIRTUALIZE_ABOVE = 100;

export function shouldVirtualize(count: number): boolean {
  return count > VIRTUALIZE_ABOVE;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function ledgerWindow({
  scrollTop,
  viewportHeight,
  rowHeight,
  count,
  overscan = 4,
}: LedgerWindowInput): LedgerWindow {
  const rows = Math.max(0, Math.floor(count));

  // A zero row height would divide by zero; render everything and move on.
  if (rowHeight <= 0 || rows === 0) {
    return { start: 0, end: rows, padTop: 0, padBottom: 0, totalHeight: 0 };
  }

  const totalHeight = rows * rowHeight;
  const top = clamp(scrollTop, 0, Math.max(0, totalHeight - Math.max(0, viewportHeight)));

  const first = clamp(Math.floor(top / rowHeight) - overscan, 0, rows);
  const last = clamp(
    Math.ceil((top + Math.max(0, viewportHeight)) / rowHeight) + overscan,
    first,
    rows,
  );

  return {
    start: first,
    end: last,
    padTop: first * rowHeight,
    padBottom: (rows - last) * rowHeight,
    totalHeight,
  };
}
