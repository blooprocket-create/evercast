import { describe, expect, it, vi } from 'vitest';
// prettier-ignore
import { InstallStore, isInstalled, shouldRegisterServiceWorker } from './Installable';

describe('recognising an installed copy', () => {
  it('reads the standard display mode', () => {
    expect(isInstalled({ matchMedia: () => ({ matches: true }) })).toBe(true);
    expect(isInstalled({ matchMedia: () => ({ matches: false }) })).toBe(false);
  });

  it('falls back to the reading Safari answers instead', () => {
    expect(isInstalled({ navigator: { standalone: true } })).toBe(true);
    expect(isInstalled({ navigator: { standalone: false } })).toBe(false);
  });

  /** A browser with neither is a browser the game still has to run in. */
  it('says no rather than throwing when a browser offers neither', () => {
    expect(isInstalled({})).toBe(false);
    expect(
      isInstalled({
        matchMedia: () => {
          throw new Error('unknown feature query');
        },
      }),
    ).toBe(false);
  });
});

describe('deciding whether to register a worker', () => {
  const environment = { production: true, supported: true, secure: true };

  it('registers only where all three hold', () => {
    expect(shouldRegisterServiceWorker(environment)).toBe(true);
    // A dev server has no built asset names to cache and would serve a stale
    // shell across an edit.
    expect(shouldRegisterServiceWorker({ ...environment, production: false })).toBe(false);
    expect(shouldRegisterServiceWorker({ ...environment, supported: false })).toBe(false);
    expect(shouldRegisterServiceWorker({ ...environment, secure: false })).toBe(false);
  });
});

describe('the install offer', () => {
  const offer = (outcome: 'accepted' | 'dismissed' = 'accepted') => ({
    prompt: vi.fn(async () => {}),
    userChoice: Promise.resolve({ outcome }),
  });

  it('starts with nothing to offer', () => {
    expect(new InstallStore(false).getState()).toEqual({ available: false, installed: false });
  });

  it('parks the browser offer instead of acting on it', () => {
    const store = new InstallStore(false);
    const listener = vi.fn();
    store.subscribe(listener);

    const event = offer();
    store.offer(event as never);
    expect(store.getState().available).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    // Parked, not shown: the dialog may only be replayed from a gesture.
    expect(event.prompt).not.toHaveBeenCalled();
  });

  it('replays it once, and reports what the player chose', async () => {
    const store = new InstallStore(false);
    const event = offer('accepted');
    store.offer(event as never);

    await expect(store.prompt()).resolves.toBe(true);
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(store.getState()).toEqual({ available: false, installed: true });

    // The offer is single-use; a second press must not replay a spent event.
    await expect(store.prompt()).resolves.toBe(false);
    expect(event.prompt).toHaveBeenCalledTimes(1);
  });

  it('leaves the offer spent but the game uninstalled when it is dismissed', async () => {
    const store = new InstallStore(false);
    store.offer(offer('dismissed') as never);
    await expect(store.prompt()).resolves.toBe(false);
    expect(store.getState()).toEqual({ available: false, installed: false });
  });

  it('survives a browser that rejects the prompt', async () => {
    const store = new InstallStore(false);
    store.offer({
      prompt: async () => {
        throw new Error('not allowed');
      },
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    } as never);
    await expect(store.prompt()).resolves.toBe(false);
  });

  it('offers nothing when the game is already installed', async () => {
    const store = new InstallStore(true);
    expect(store.getState().installed).toBe(true);
    await expect(store.prompt()).resolves.toBe(false);
  });

  it('notices an install that happened by another route', () => {
    const store = new InstallStore(false);
    const listener = vi.fn();
    store.subscribe(listener);
    store.taken();
    expect(store.getState()).toEqual({ available: false, installed: true });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('publishes only on a real change, so a subscriber is not woken for nothing', () => {
    const store = new InstallStore(false);
    const listener = vi.fn();
    store.subscribe(listener);
    store.taken();
    store.taken();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
