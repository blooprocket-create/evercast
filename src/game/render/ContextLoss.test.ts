import { NullEngine } from '@babylonjs/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// prettier-ignore
import { CONTEXT_LOST_MESSAGE, CONTEXT_RESTORED_MESSAGE, watchContextLoss } from './ContextLoss';

let engine: NullEngine;

beforeEach(() => {
  engine = new NullEngine();
});

afterEach(() => {
  engine.dispose();
});

/** Babylon's own observables, fired the way the browser would fire them. */
const loseContext = () => engine.onContextLostObservable.notifyObservers(engine);
const restoreContext = () => engine.onContextRestoredObservable.notifyObservers(engine);

describe('watchContextLoss', () => {
  it('says when the context goes and when it comes back', () => {
    const onLost = vi.fn();
    const onRestored = vi.fn();
    watchContextLoss(engine, { onLost, onRestored });

    loseContext();
    expect(onLost).toHaveBeenCalledWith(CONTEXT_LOST_MESSAGE);
    expect(onRestored).not.toHaveBeenCalled();

    restoreContext();
    expect(onRestored).toHaveBeenCalledWith(CONTEXT_RESTORED_MESSAGE);
  });

  it('reports every loss, because a tab can lose the context more than once', () => {
    const onLost = vi.fn();
    watchContextLoss(engine, { onLost, onRestored: () => {} });

    for (let time = 0; time < 3; time += 1) {
      loseContext();
      restoreContext();
    }
    expect(onLost).toHaveBeenCalledTimes(3);
  });

  it('goes quiet once it is taken back off, so a rebuilt scene does not double up', () => {
    const onLost = vi.fn();
    const stop = watchContextLoss(engine, { onLost, onRestored: () => {} });

    stop();
    loseContext();
    expect(onLost).not.toHaveBeenCalled();
  });

  it('reports through the console when nothing else is given', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    watchContextLoss(engine);
    loseContext();
    restoreContext();

    expect(error).toHaveBeenCalledWith(CONTEXT_LOST_MESSAGE);
    expect(info).toHaveBeenCalledWith(CONTEXT_RESTORED_MESSAGE);
    error.mockRestore();
    info.mockRestore();
  });
});
