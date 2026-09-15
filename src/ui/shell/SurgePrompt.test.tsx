import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EvercastSimulation } from '../../engine/EvercastSimulation';
import { SurgePromptView, type SurgePromptViewProps } from './SurgePrompt';

/**
 * Structural assertions with no DOM, the way `Shelf.test.tsx` does it: the view
 * is pure and prop-driven, and `react-dom` already ships a server renderer.
 */
const render = (props: Partial<SurgePromptViewProps> = {}) =>
  renderToStaticMarkup(
    <SurgePromptView
      surge={{ enemyName: 'Road Warden', secondsRemaining: 1.1, windowSeconds: 2.2 }}
      charges={2}
      maxCharges={2}
      rechargeFraction={1}
      onCounter={() => {}}
      {...props}
    />,
  );

describe('the Surge prompt', () => {
  it('draws nothing at all when no Surge is in the air', () => {
    expect(render({ surge: null })).toBe('');
  });

  it('names what is gathering, so the prompt is about the fight and not the button', () => {
    expect(render()).toContain('Road Warden');
  });

  it('is a real button, so the keyboard reaches it without a global binding', () => {
    expect(render()).toContain('<button');
    expect(render()).toContain('type="button"');
  });

  it('says how many charges are left where a screen reader will find it', () => {
    expect(render({ charges: 1 })).toContain('aria-label="Counterspell. 1 of 2 charges."');
  });

  /**
   * The window is the only thing on screen that is true about the simulation
   * rather than about the presentation, so it is drawn from the seconds the
   * snapshot reports rather than from a CSS animation timed to look right.
   */
  it('draws the closing window from the seconds left', () => {
    expect(render({ surge: { enemyName: 'x', secondsRemaining: 2.2, windowSeconds: 2.2 } })).toContain(
      'scaleX(1)',
    );
    expect(render({ surge: { enemyName: 'x', secondsRemaining: 0.55, windowSeconds: 2.2 } })).toContain(
      'scaleX(0.25)',
    );
  });

  it('clamps a window that has already closed rather than inverting the bar', () => {
    const markup = render({ surge: { enemyName: 'x', secondsRemaining: -1, windowSeconds: 2.2 } });
    expect(markup).toContain('scaleX(0)');
  });

  it('disables itself rather than offering a press that the engine would refuse', () => {
    expect(render({ charges: 0 })).toContain('disabled');
    expect(render({ charges: 0 })).toContain('No charge');
    expect(render({ charges: 1 })).not.toContain('disabled');
  });

  /**
   * A live region re-announces whenever its text changes. The countdown is in
   * the markup and must never be in the announcement, or a screen reader would
   * read the window out loud twenty times while it closed.
   */
  it('announces once, with text that does not tick', () => {
    const early = render({ surge: { enemyName: 'Road Warden', secondsRemaining: 2.2, windowSeconds: 2.2 } });
    const late = render({ surge: { enemyName: 'Road Warden', secondsRemaining: 0.2, windowSeconds: 2.2 } });
    const announcement = (markup: string) => markup.match(/role="alert"[^>]*>([^<]*)</)?.[1];
    expect(announcement(early)).toBeTruthy();
    expect(announcement(early)).toBe(announcement(late));
  });

  it('reads the shape the engine actually publishes', () => {
    const snapshot = new EvercastSimulation().getSnapshot();
    // A fresh run is not at a boss, so there is nothing to answer yet - but the
    // pool has to be there, or the prompt would have nothing to draw when one
    // arrives.
    expect(snapshot.surge).toBeNull();
    expect(snapshot.counterspell.maxCharges).toBeGreaterThan(0);
    expect(snapshot.counterspell.charges).toBe(snapshot.counterspell.maxCharges);
    expect(snapshot.counterspell.ready).toBe(false);
    expect(render({ surge: snapshot.surge, ...snapshot.counterspell })).toBe('');
  });
});
