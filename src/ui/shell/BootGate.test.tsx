import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BootGate } from './BootGate';

/**
 * Structural assertions with no DOM and no new dependencies, the same shape
 * `nav/Shelf.test.tsx` uses: the component is pure and prop-driven, and
 * react-dom already ships a server renderer.
 */
const render = (props: Parameters<typeof BootGate>[0]) => renderToStaticMarkup(<BootGate {...props} />);

const noop = () => {};

/** The gate as it is for a machine with no renderer: dark, and fully working. */
const unlit = { lit: false, onBegin: noop } as const;

describe('boot gate', () => {
  it('holds the player while the world is still arriving', () => {
    const markup = render({ phase: 'preparing', resumed: false, ...unlit });
    expect(markup).toContain('EVERCAST');
    expect(markup).toContain('disabled');
    expect(markup).toContain('aria-busy="true"');
  });

  it('releases them once it has', () => {
    const markup = render({ phase: 'ready', resumed: false, ...unlit });
    expect(markup).toContain('Begin');
    expect(markup).not.toContain('disabled');
  });

  it('greets a new player and welcomes back a returning one', () => {
    expect(render({ phase: 'ready', resumed: false, ...unlit })).toContain('Begin');
    expect(render({ phase: 'ready', resumed: true, ...unlit })).toContain('Continue');
  });

  /**
   * The gate is the only guaranteed gesture in an idle game, so it has to be
   * gone the moment it has collected one - otherwise it is covering the world
   * it just unlocked.
   */
  it('draws nothing at all once the game is playing', () => {
    expect(render({ phase: 'playing', resumed: false, ...unlit })).toBe('');
    expect(render({ phase: 'playing', resumed: true, ...unlit })).toBe('');
  });

  /**
   * The curtain is what stands between the title and a world still assembling
   * itself, so when it lifts is a correctness question, not a visual one.
   */
  it('keeps the curtain down until the scene says a title frame is on screen', () => {
    expect(render({ phase: 'ready', resumed: false, ...unlit })).not.toContain('_lit_');
    expect(render({ phase: 'ready', resumed: false, lit: true, onBegin: noop })).toContain('_lit_');
  });

  it('never lifts it while still preparing, whatever the scene reports', () => {
    // `showTitle` resolving early must not out-rank the phase: a gate that is
    // not ready has nothing behind it worth showing.
    expect(render({ phase: 'preparing', resumed: false, lit: true, onBegin: noop })).not.toContain(
      '_lit_',
    );
  });

  it('is a modal dialog, so nothing behind it is reachable by keyboard', () => {
    const markup = render({ phase: 'ready', resumed: false, ...unlit });
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
  });
});
