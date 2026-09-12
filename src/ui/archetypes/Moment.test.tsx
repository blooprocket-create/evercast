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

/**
 * Where focus lands when a moment opens.
 *
 * Static markup cannot run the effect that moves focus, but it can prove the
 * mechanism is attached to the right button - which is the part that was
 * wrong. The end-to-end behaviour is checked in a browser.
 */
const autofocusedLabel = (markup: string): string | null => {
  const index = markup.indexOf('data-autofocus');
  if (index === -1) return null;
  const label = markup.slice(index).match(/>([^<]+)<\/button>/);
  return label?.[1] ?? null;
};

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

  /**
   * A confirmation opens on its safe half.
   *
   * `Moment` draws the primary action first, so the first focusable in an
   * "Erase this run?" dialog was `Erase everything` - reached by pressing
   * Enter, which is also how the player got there. One auto-repeat and the run
   * was gone with no undo.
   */
  describe('a destructive confirmation', () => {
    it('puts the opening focus on the way out, not the deletion', () => {
      const markup = render({
        tone: 'danger',
        headline: 'Erase this run?',
        primary: { label: 'Erase everything', onClick: () => {} },
        secondary: { label: 'Keep my run', onClick: () => {} },
      });
      expect(autofocusedLabel(markup)).toBe('Keep my run');
    });

    it('still draws the primary action first', () => {
      const markup = render({
        tone: 'danger',
        primary: { label: 'Erase everything', onClick: () => {} },
        secondary: { label: 'Keep my run', onClick: () => {} },
      });
      // Moving the focus must not reorder what the player sees.
      expect(markup.indexOf('Erase everything')).toBeLessThan(markup.indexOf('Keep my run'));
    });

    it('leaves a death screen alone: one button, nothing to protect against', () => {
      expect(autofocusedLabel(render({ tone: 'danger' }))).toBeNull();
    });

    it('leaves an ordinary moment alone, so the offer keeps the focus', () => {
      const markup = render({
        tone: 'accent',
        primary: { label: 'Rebirth', onClick: () => {} },
        secondary: { label: 'Not yet', onClick: () => {} },
      });
      expect(autofocusedLabel(markup)).toBeNull();
    });

    it('does not claim focus at all when it is a surface rather than a dialog', () => {
      const markup = render({
        tone: 'danger',
        modal: false,
        primary: { label: 'Erase everything', onClick: () => {} },
        secondary: { label: 'Keep my run', onClick: () => {} },
      });
      expect(autofocusedLabel(markup)).toBeNull();
    });
  });
});
