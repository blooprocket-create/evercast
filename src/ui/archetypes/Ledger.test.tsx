import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LEDGER_ROW_HEIGHT, Ledger } from './Ledger';
import { VIRTUALIZE_ABOVE } from './LedgerWindow';

/**
 * Eight gear slots do not need windowing, but the archetype does: the same
 * component has to hold a 240-row achievement list and whatever comes after.
 * Assert the behaviour now, while the only caller is small.
 */
const items = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `row-${i}` }));

const render = (count: number) =>
  renderToStaticMarkup(
    <Ledger
      items={items(count)}
      rowKey={(item) => item.id}
      renderRow={(item) => <span>{item.id}</span>}
      empty="Nothing here"
    />,
  );

const countRows = (markup: string) => (markup.match(/row-\d+/g) ?? []).length;

describe('Ledger', () => {
  it('renders every row while the list is short', () => {
    expect(countRows(render(8))).toBe(8);
    expect(countRows(render(VIRTUALIZE_ABOVE))).toBe(VIRTUALIZE_ABOVE);
  });

  it('renders only a window once the list is long', () => {
    const markup = render(5000);
    const rendered = countRows(markup);
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(60);
  });

  it('reserves the full scroll height so the scrollbar is honest', () => {
    // The rows it skips become spacer height, not missing content.
    expect(render(5000)).toContain(`height:${(5000 - countRows(render(5000))) * LEDGER_ROW_HEIGHT}px`);
  });

  it('shows the empty state rather than a bare box', () => {
    expect(render(0)).toContain('Nothing here');
  });
});
