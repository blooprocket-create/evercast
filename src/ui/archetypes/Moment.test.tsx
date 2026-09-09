import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EvercastSimulation } from '../../engine/EvercastSimulation';
import { Moment, type MomentCells } from './Moment';

/**
 * The cap on this archetype is the point of it: one headline, at most three
 * cells, at most two buttons. `cells` is a tuple type, so a fourth cell is a
 * compile error rather than a lint rule someone can talk their way past.
 */
const cells: MomentCells = [
  { label: 'Reached', value: '42' },
  { label: 'Short by', value: '1.9e+6' },
  { label: 'Survived', value: '38s' },
];

const render = (props: Partial<Parameters<typeof Moment>[0]> = {}) =>
  renderToStaticMarkup(
    <Moment
      tone="danger"
      icon="rebirth"
      headline="The Evercast falters"
      consequence="You keep every level, point and coin."
      primary={{ label: 'Farm Frontier 38', onClick: () => {} }}
      {...props}
    />,
  );

const countButtons = (markup: string) => markup.split('<button').length - 1;

describe('Moment', () => {
  it('states one thing and offers one choice', () => {
    const markup = render();
    expect(markup).toContain('The Evercast falters');
    expect(markup).toContain('You keep every level, point and coin.');
    expect(countButtons(markup)).toBe(1);
  });

  it('never offers more than two actions', () => {
    const markup = render({ secondary: { label: 'Try again', onClick: () => {} } });
    expect(countButtons(markup)).toBe(2);
  });

  it('renders one, two or three cells and no more', () => {
    for (const set of [
      [cells[0]] as MomentCells,
      [cells[0], cells[1]] as MomentCells,
      cells,
    ]) {
      const markup = render({ cells: set });
      for (const cell of set) expect(markup).toContain(cell.label);
    }
    // A fourth cell does not typecheck; see MomentCells.
  });

  it('is a labelled modal', () => {
    const markup = render();
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-label="The Evercast falters"');
  });

  it('paints no colour of its own', () => {
    expect(render({ cells })).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(/);
  });
});

describe('rebirth gating', () => {
  it('stays hidden until the engine allows it', () => {
    // The registry hides Rebirth on `canRebirth`, which the engine only sets
    // once a run has reached the unlock stage. Verified here rather than by
    // eye, since reaching it takes real playtime.
    const snapshot = new EvercastSimulation().getSnapshot();
    expect(snapshot.canRebirth).toBe(false);
    expect(snapshot.rebirthKnowledgeGain.display).toBe('0');
  });
});
