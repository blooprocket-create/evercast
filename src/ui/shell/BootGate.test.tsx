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

describe('boot gate', () => {
  it('holds the player while the world is still arriving', () => {
    const markup = render({ phase: 'preparing', resumed: false, onBegin: noop });
    expect(markup).toContain('EVERCAST');
    expect(markup).toContain('disabled');
    expect(markup).toContain('aria-busy="true"');
  });

  it('releases them once it has', () => {
    const markup = render({ phase: 'ready', resumed: false, onBegin: noop });
    expect(markup).toContain('Begin');
    expect(markup).not.toContain('disabled');
  });

  it('greets a new player and welcomes back a returning one', () => {
    expect(render({ phase: 'ready', resumed: false, onBegin: noop })).toContain('Begin');
    expect(render({ phase: 'ready', resumed: true, onBegin: noop })).toContain('Continue');
  });

  /**
   * The gate is the only guaranteed gesture in an idle game, so it has to be
   * gone the moment it has collected one - otherwise it is covering the world
   * it just unlocked.
   */
  it('draws nothing at all once the game is playing', () => {
    expect(render({ phase: 'playing', resumed: false, onBegin: noop })).toBe('');
    expect(render({ phase: 'playing', resumed: true, onBegin: noop })).toBe('');
  });

  it('is a modal dialog, so nothing behind it is reachable by keyboard', () => {
    const markup = render({ phase: 'ready', resumed: false, onBegin: noop });
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
  });
});
