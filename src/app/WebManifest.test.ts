import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The manifest, the worker and the markup that points at them.
 *
 * All three live outside `src/`, which is exactly why they are pinned here -
 * nothing in the module graph imports any of them, so a rename or a deleted
 * icon would be invisible until someone tried to install the game. This is the
 * same argument `SecurityHeaders.test.ts` makes about `vercel.json`.
 */
const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const manifest = JSON.parse(read('public/manifest.webmanifest')) as {
  name: string;
  start_url: string;
  scope: string;
  display: string;
  background_color: string;
  theme_color: string;
  icons: { src: string; sizes: string; type: string; purpose: string }[];
};
const html = read('index.html');
const worker = read('public/sw.js');
const tokens = read('src/ui/theme/tokens.css');

describe('the web manifest', () => {
  it('asks to be launched as an app rather than in a tab', () => {
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
  });

  /**
   * The splash a launcher paints before a single line of script runs. It has
   * to be the game's own night or the launch flashes white - which is the same
   * reason `index.html` carries a background colour inline.
   */
  it('paints its launch screen in the colour the game actually is', () => {
    const bg = tokens.match(/--bg:\s*(#[0-9a-f]{6})/i)?.[1];
    expect(bg).toBeTruthy();
    expect(manifest.background_color.toLowerCase()).toBe(bg!.toLowerCase());
    expect(manifest.theme_color.toLowerCase()).toBe(bg!.toLowerCase());
    expect(html).toContain(`content="${bg}"`);
  });

  it('ships every icon it names', () => {
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
    for (const icon of manifest.icons) {
      expect(icon.src.startsWith('/'), icon.src).toBe(true);
      expect(existsSync(join(root, 'public', icon.src)), icon.src).toBe(true);
    }
  });

  /**
   * Android crops a circle out of an icon it is allowed to mask. Without a
   * `maskable` entry drawn inside the safe area it crops the `any` one instead,
   * and takes the corners of the artwork with it.
   */
  it('carries a maskable icon as well as a plain one', () => {
    const purposes = manifest.icons.map((icon) => icon.purpose);
    expect(purposes).toContain('any');
    expect(purposes).toContain('maskable');
    expect(manifest.icons.some((icon) => icon.purpose === 'any' && icon.sizes === '512x512')).toBe(true);
  });

  it('is linked from the markup, along with the icons Safari reads instead', () => {
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('/manifest.webmanifest');
    expect(html).toContain('rel="apple-touch-icon"');
    expect(existsSync(join(root, 'public/icons/apple-touch-icon.png'))).toBe(true);
    expect(html).toContain('apple-mobile-web-app-capable');
  });
});

describe('the service worker', () => {
  it('handles nothing but same-origin reads', () => {
    expect(worker).toContain("request.method !== 'GET'");
    expect(worker).toContain('url.origin !== self.location.origin');
  });

  /**
   * The promise `connect-src 'self'` makes in `vercel.json` is that nothing
   * leaves the device. A worker is the one piece of Evercast that could quietly
   * break it, because it sees every request the page makes - so it must never
   * name a host.
   */
  it('names no host anywhere, which is what keeps the privacy claim true', () => {
    const urls = worker.match(/https?:\/\/[^\s'"`)]+/g) ?? [];
    expect(urls).toEqual([]);
  });

  it('serves the shell from the network first, so a stale one cannot pin a build', () => {
    expect(worker).toContain("request.mode === 'navigate'");
    expect(worker).toContain('shellFirst');
  });

  /**
   * Cache-first is only safe where the name carries a content hash. Vite writes
   * those into `assets/`, so that prefix - and nothing wider - may be treated
   * as immutable; everything else revalidates behind the player.
   */
  it('treats only the hashed bundles as immutable', () => {
    expect(worker).toMatch(/const HASHED = \/\^\\\/assets\\\//);
    for (const directory of ['models', 'fonts', 'icons']) {
      expect(worker, directory).toContain(directory);
    }
    expect(worker).toContain('staleWhileRevalidate');
  });

  /**
   * The gap a review caught and a measurement confirmed: registration is
   * deferred to `load`, so on a first visit the entry bundle, the stylesheet
   * and the preloaded typefaces are all fetched before the worker exists. It
   * never sees those requests, so it must go and get them itself.
   */
  it('precaches the shell it provably cannot intercept', () => {
    expect(worker).toContain('shellResources');
    // Read out of the shipped shell, so a content hash can never go stale here.
    expect(worker).toMatch(/fetch\('\/'\)/);
    expect(worker).toMatch(/src\|href/);
  });

  /**
   * `Vary: Origin` from the host makes a cached entry match only when the
   * stored request's Origin agrees with the incoming one - and the worker's own
   * fetch sends none while a module-script request does. Without this the
   * precache above stores exactly the right files and then fails to serve them.
   */
  it('ignores Vary on every lookup, or the precache is worthless', () => {
    expect(worker).toContain('ignoreVary: true');
    const lookups = worker.match(/(?:caches|cache)\.match\(/g) ?? [];
    const withMatchOptions = worker.match(/(?:caches|cache)\.match\([^)]*MATCH\)/g) ?? [];
    expect(lookups.length).toBeGreaterThan(0);
    expect(withMatchOptions.length).toBe(lookups.length);
  });

  /**
   * Precaching every chunk would roughly double a first visit: the build emits
   * 467 files totalling 7.4 MB and a normal boot requests about thirty. The
   * shell is the bounded set the worker cannot otherwise reach.
   */
  it('does not force a revalidation while the install blocks activation', () => {
    // Comments stripped first: this file explains at length why `reload` was
    // removed, and the explanation must not read as the thing it warns about.
    const code = worker.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toContain("cache: 'reload'");
    expect(code).toContain('ignoreVary');
  });

  it('is registered from the app rather than from the markup', () => {
    // `Installable.ts` can guard it; a script tag in the HTML cannot.
    expect(html).not.toContain('serviceWorker');
    expect(read('src/app/Installable.ts')).toContain('serviceWorker.register');
  });
});
