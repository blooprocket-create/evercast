import { describe, expect, it, vi } from 'vitest';

/**
 * Erase did not erase, and import did not import.
 *
 * Both end in `window.location.reload()`, which schedules a navigation rather
 * than performing one. The session stayed up in the meantime, and the game loop
 * holds a `beforeunload` handler whose entire job is to write one last save on
 * the way out - so the reload the player had just asked for was itself what put
 * the deleted run back into storage, under the key it had been removed from.
 * The page came back with everything still there.
 *
 * So these tests do not call `saveGame` to stand in for that handler. They start
 * a real loop, take the listener it registers, and fire it - because the bug was
 * never in `saveGame`; it was in who else was still allowed to call it.
 */

const SAVE_KEY = 'evercast.save.v1';

type Listener = () => void;

/** The smallest browser `runtime` and `GameLoop` need, so this runs in node. */
function installBrowser() {
  const items = new Map<string, string>();
  const listeners = new Map<string, Set<Listener>>();
  const intervals: Listener[] = [];
  const reload = vi.fn();

  const on = (type: string, listener: Listener) => {
    const set = listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    listeners.set(type, set);
  };

  Object.assign(globalThis, {
    localStorage: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
      removeItem: (key: string) => void items.delete(key),
    },
    document: {
      hidden: false,
      addEventListener: on,
      removeEventListener: (type: string, listener: Listener) =>
        void listeners.get(type)?.delete(listener),
    },
    window: {
      location: { reload },
      setInterval: (callback: Listener) => intervals.push(callback),
      clearInterval: () => {},
      addEventListener: on,
      removeEventListener: (type: string, listener: Listener) =>
        void listeners.get(type)?.delete(listener),
    },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
  });

  return {
    saved: () => items.get(SAVE_KEY) ?? null,
    reload,
    /** Everything still holding the session when the reload was asked for. */
    fireUnload: () => {
      for (const listener of listeners.get('beforeunload') ?? []) listener();
    },
    fireAutosave: () => {
      for (const callback of intervals) callback();
    },
  };
}

/**
 * A fresh module graph per test. `runtime` is a singleton that latches once the
 * save has been deliberately replaced, and a latch is not meant to come back up
 * - so the two cases below need separate instances of it rather than separate
 * `it` blocks over one.
 */
async function boot() {
  vi.resetModules();
  const browser = installBrowser();
  const runtime = await import('./runtime');
  const { startGameLoop } = await import('./GameLoop');
  const stop = startGameLoop({ scene: null, onAwayProgress: () => {} });
  return { browser, runtime, stop };
}

describe('erase', () => {
  it('stays erased through the reload it asks for', async () => {
    const { browser, runtime, stop } = await boot();

    runtime.saveGame();
    expect(browser.saved()).not.toBeNull();

    runtime.eraseSave();
    expect(browser.saved()).toBeNull();
    expect(browser.reload).toHaveBeenCalledTimes(1);

    // The regression, exactly as it happened: the page is on its way out, and
    // the handler that banks the last few seconds of play runs.
    browser.fireUnload();
    expect(browser.saved()).toBeNull();

    // The other two writers on the same ten-second cadence, for the same reason.
    browser.fireAutosave();
    expect(browser.saved()).toBeNull();
    stop();
    expect(browser.saved()).toBeNull();
  });
});

describe('import', () => {
  it('keeps the imported file rather than the run it replaced', async () => {
    const { browser, runtime, stop } = await boot();

    const file = runtime.exportSaveFile();
    // Somewhere else entirely, so "the file survived" is a claim with teeth.
    runtime.simulation.update(120);
    runtime.saveGame();
    expect(browser.saved()).not.toEqual(file);

    runtime.importSaveFile(file);
    expect(browser.saved()).toEqual(file);

    browser.fireUnload();
    browser.fireAutosave();
    stop();
    expect(browser.saved()).toEqual(file);
  });

  it('goes on saving when the file was refused', async () => {
    const { browser, runtime, stop } = await boot();

    // The latch is permanent, so dropping it on a throwing path would leave a
    // player who picked the wrong file with a session that silently never saves
    // again - a worse outcome than the bad import they already noticed.
    expect(() => runtime.importSaveFile('{"not":"a save"}')).toThrow();

    runtime.simulation.update(30);
    browser.fireUnload();
    expect(browser.saved()).not.toBeNull();
    stop();
  });
});
