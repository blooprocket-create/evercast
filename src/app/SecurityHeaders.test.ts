import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The deployed response headers, asserted from the file that declares them.
 *
 * These are the only security control in Evercast that lives outside the
 * source: nothing in `src/` can tell whether the CSP is still there, and a
 * one-line edit to `vercel.json` would remove it silently. So the rules are
 * pinned here, where the suite that already runs on every pull request will
 * notice.
 *
 * The policy itself was verified against the production build in a real
 * Chromium - the whole game boots under it with no violations reported, and a
 * deliberate `fetch` to `cdn.babylonjs.com` (which `@babylonjs/loaders` would
 * use if glTF validation were ever switched on) is refused by `connect-src`.
 * That check needs a browser, so it is not part of this suite; what is here is
 * the guarantee that the policy it verified is still the policy being shipped.
 */

const vercel = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as {
  headers?: { source: string; headers: { key: string; value: string }[] }[];
};

const rule = vercel.headers?.[0];
const header = (key: string): string =>
  rule?.headers.find((entry) => entry.key.toLowerCase() === key.toLowerCase())?.value ?? '';

describe('deployed security headers', () => {
  it('applies to every path', () => {
    expect(vercel.headers).toHaveLength(1);
    expect(rule?.source).toBe('/(.*)');
  });

  describe('the content security policy', () => {
    const csp = header('Content-Security-Policy');
    const directive = (name: string): string[] => {
      const found = csp
        .split(';')
        .map((part) => part.trim())
        .find((part) => part === name || part.startsWith(`${name} `));
      return found ? found.split(/\s+/).slice(1) : [];
    };

    it('defaults to this origin and nothing else', () => {
      expect(directive('default-src')).toEqual(["'self'"]);
    });

    /**
     * The build emits one external module and no inline script, so the policy
     * never needs `'unsafe-inline'` here - which is what makes it worth having,
     * since an injected `<script>` is the attack it actually stops. `blob:` is
     * for Babylon, which builds its transcoder workers from object URLs.
     */
    it('allows no inline or evaluated script', () => {
      const scripts = directive('script-src');
      expect(scripts).toContain("'self'");
      expect(scripts).toContain('blob:');
      expect(scripts).not.toContain("'unsafe-inline'");
      expect(scripts).not.toContain("'unsafe-eval'");
      expect(csp).not.toContain("'unsafe-eval'");
    });

    /**
     * The one concession, and it buys no script execution. `index.html` paints
     * its splash from an inline `<style>` before any stylesheet loads, and the
     * shell sets the biome accent through an inline `style` attribute.
     */
    it('allows inline style, and only style', () => {
      expect(directive('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
    });

    /**
     * The directive that matters most for a game that promises it sends
     * nothing: an added dependency that tried to reach a third party would be
     * refused by the browser rather than quietly succeeding. See
     * `docs/PRIVACY.md`.
     */
    it('permits no outbound connection to anywhere but this origin', () => {
      expect(directive('connect-src')).toEqual(["'self'"]);
    });

    it('closes the directives that have no use here', () => {
      expect(directive('object-src')).toEqual(["'none'"]);
      expect(directive('base-uri')).toEqual(["'none'"]);
      expect(directive('form-action')).toEqual(["'none'"]);
      expect(directive('frame-ancestors')).toEqual(["'none'"]);
    });

    it('leaves nothing to fall through to default-src by accident', () => {
      for (const name of ['img-src', 'font-src', 'media-src', 'worker-src']) {
        expect(directive(name).length, name).toBeGreaterThan(0);
      }
    });

    /**
     * The service worker registers against `worker-src`, and everything it
     * fetches is same-origin and therefore against `connect-src`. Both are
     * already exactly what they need to be - this is here so that stays true,
     * because a policy tightened without knowing about the worker would take
     * offline launch away with no test failing anywhere near it.
     */
    it('permits the service worker, and still lets it reach nothing but this origin', () => {
      expect(directive('worker-src')).toContain("'self'");
      expect(directive('connect-src')).toEqual(["'self'"]);
    });

    /** The manifest is fetched against `manifest-src`, which is not set. */
    it('leaves the manifest to default-src, which allows exactly this origin', () => {
      expect(directive('manifest-src')).toEqual([]);
      expect(directive('default-src')).toEqual(["'self'"]);
    });
  });

  it('refuses to be framed, sniffed, or to leak a referrer', () => {
    expect(header('X-Frame-Options')).toBe('DENY');
    expect(header('X-Content-Type-Options')).toBe('nosniff');
    expect(header('Referrer-Policy')).toBe('no-referrer');
  });

  /**
   * Evercast asks for no device capability at all, so every one of them is
   * denied rather than left at the browser's default. An empty allowlist is
   * how a Permissions-Policy says "not even this document".
   */
  it('denies every device capability', () => {
    const policy = header('Permissions-Policy');
    for (const capability of ['camera', 'microphone', 'geolocation', 'payment', 'usb']) {
      expect(policy, capability).toContain(`${capability}=()`);
    }
  });

  it('isolates the browsing context and pins HTTPS', () => {
    expect(header('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(header('Cross-Origin-Resource-Policy')).toBe('same-origin');
    expect(header('Strict-Transport-Security')).toMatch(/max-age=\d{7,}/);
  });
});
