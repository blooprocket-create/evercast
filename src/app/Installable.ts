/**
 * Making Evercast something you can keep, rather than a tab you have to find
 * again.
 *
 * Two separable things live here because they answer the same question:
 * `registerServiceWorker` is what lets the game open without a network, and
 * `InstallStore` is what lets the player put it on a home screen. Both are
 * written the way `BrowserSaveStore` is - every browser capability reached for
 * behind a guard, and the game running perfectly well without any of them.
 * Neither is allowed to be a reason the app fails to start.
 */

/** What the interface needs to know. See `SettingsSurface`. */
export interface InstallState {
  /** The browser has offered an install and the player has not taken it. */
  available: boolean;
  /** Already running as an installed app, so there is nothing to offer. */
  installed: boolean;
}

/**
 * The event Chromium fires when it decides a site is installable. Typed here
 * rather than imported: it is not in the DOM lib, and one optional capability
 * is not worth widening the project's type surface for.
 */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Whether the page is already running as an installed app.
 *
 * Two readings because the platforms disagree: `display-mode` is the standard
 * and iOS Safari answers `navigator.standalone` instead. Pure so the decision
 * can be tested without a browser that has either.
 */
export interface InstallabilityView {
  matchMedia?: (query: string) => { matches: boolean };
  /**
   * `standalone` is Safari's, and is not in the DOM lib - so the reading is
   * widened here rather than the global `Navigator` being augmented, which
   * would tell every other file in the project that it exists.
   */
  navigator?: { standalone?: boolean } | Navigator;
}

export function isInstalled(view: InstallabilityView): boolean {
  try {
    if (view.matchMedia?.('(display-mode: standalone)').matches) return true;
  } catch {
    // A `matchMedia` that throws on an unknown feature query is not a reason
    // to fail; it just means we have to fall through to the iOS reading.
  }
  return (view.navigator as { standalone?: boolean } | undefined)?.standalone === true;
}

type Listener = () => void;

export class InstallStore {
  private deferred: InstallPromptEvent | null = null;
  private state: InstallState;
  private readonly listeners = new Set<Listener>();

  constructor(installed: boolean) {
    this.state = { available: false, installed };
  }

  readonly getState = (): InstallState => this.state;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Holds on to the browser's offer instead of acting on it.
   *
   * The event has to be intercepted the moment it fires or the browser shows
   * its own bar, and it can only be replayed from a user gesture - so the
   * offer is parked here and Settings decides when to make it. An idle game
   * that interrupted a fight to ask for a home-screen icon would deserve the
   * dismissal it got.
   */
  offer(event: InstallPromptEvent): void {
    this.deferred = event;
    this.publish({ ...this.state, available: true });
  }

  /** Called when the browser reports the install happened, by any route. */
  taken(): void {
    this.deferred = null;
    this.publish({ available: false, installed: true });
  }

  /** Replays the browser's own dialog. Resolves to whether it was accepted. */
  async prompt(): Promise<boolean> {
    const event = this.deferred;
    if (!event) return false;
    // Cleared first: the offer is single-use, and a second press while the
    // dialog is open would be refused by the browser anyway.
    this.deferred = null;
    this.publish({ ...this.state, available: false });
    try {
      await event.prompt();
      const { outcome } = await event.userChoice;
      if (outcome === 'accepted') this.taken();
      return outcome === 'accepted';
    } catch {
      return false;
    }
  }

  private publish(next: InstallState): void {
    if (next.available === this.state.available && next.installed === this.state.installed) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }
}

export function createInstallStore(): InstallStore {
  const store = new InstallStore(typeof window === 'undefined' ? false : isInstalled(window));
  if (typeof window === 'undefined') return store;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    store.offer(event as InstallPromptEvent);
  });
  window.addEventListener('appinstalled', () => store.taken());
  return store;
}

/**
 * Whether registering a worker is worth attempting at all.
 *
 * Pure, and separate from the registration itself, because the interesting
 * part is the decision: a dev server has no built asset names for the worker
 * to cache and would serve a stale shell across an edit, and a browser without
 * `serviceWorker` is simply a browser the game still has to run in.
 */
export function shouldRegisterServiceWorker(environment: {
  production: boolean;
  supported: boolean;
  secure: boolean;
}): boolean {
  return environment.production && environment.supported && environment.secure;
}

/**
 * Registers the worker, after load.
 *
 * Deliberately not on the way to the first frame: `runtime.ts` is imported
 * before the first render, and the boot gate is already streaming six
 * megabytes of models. A worker registration competing with that buys nothing
 * on the visit it happens on - it is the *next* launch this is for.
 */
export function registerServiceWorker(): void {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
  const environment = {
    production: import.meta.env.PROD,
    supported: 'serviceWorker' in navigator,
    // `localhost` counts as secure, which is what makes a production build
    // testable with `vite preview`.
    secure: window.isSecureContext,
  };
  if (!shouldRegisterServiceWorker(environment)) return;

  const register = () => {
    // A rejected registration is a game without offline support, not a broken
    // game, so it is swallowed rather than surfaced.
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
