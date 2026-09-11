import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The mobile rules, as regexes over source text - the same shape
 * `src/ui/architecture.test.ts` already uses for the design rules.
 *
 * Every assertion here is a bug that shipped, not a style preference. A phone
 * is not a narrow desktop: its viewport height moves while you use it, its
 * corners are rounded, part of its screen belongs to the system, and its
 * pointer is a fingertip. Each of those broke something, and each has a rule.
 */

const SRC = join(process.cwd(), 'src');
const UI_ROOT = join(SRC, 'ui');

interface SourceFile {
  relativePath: string;
  text: string;
}

function collect(directory: string): SourceFile[] {
  const files: SourceFile[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      files.push(...collect(path));
      continue;
    }
    if (!/\.css$/.test(entry)) continue;
    files.push({
      relativePath: relative(UI_ROOT, path).split(sep).join('/'),
      text: readFileSync(path, 'utf8'),
    });
  }
  return files;
}

const STYLESHEETS = collect(UI_ROOT);
const sheet = (relativePath: string): string => {
  const found = STYLESHEETS.find((file) => file.relativePath === relativePath);
  if (!found) throw new Error(`no stylesheet at src/ui/${relativePath}`);
  return found.text;
};

/** Reports `file:line` for each match so a failure names the offender. */
function offences(files: SourceFile[], pattern: RegExp): string[] {
  const found: string[] = [];
  for (const file of files) {
    file.text.split('\n').forEach((line, index) => {
      if (pattern.test(line)) found.push(`${file.relativePath}:${index + 1} ${line.trim()}`);
    });
  }
  return found;
}

/** Declarations only - a rule that merely names a token in a comment is fine. */
const declarations = (css: string): string =>
  css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('mobile layout', () => {
  it('has stylesheets to check', () => {
    expect(STYLESHEETS.length).toBeGreaterThan(0);
  });

  it('asks for the safe-area insets it pads with', () => {
    // Without viewport-fit=cover every env(safe-area-inset-*) reads 0px, and
    // the padding below it silently does nothing on the phones that need it.
    const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
    expect(html).toMatch(/<meta[^>]*name="viewport"[\s\S]*?viewport-fit=cover/);

    const tokens = sheet('theme/tokens.css');
    for (const edge of ['top', 'right', 'bottom', 'left'])
      expect(tokens).toContain(`--safe-${edge}: env(safe-area-inset-${edge}, 0px)`);
  });

  it('reads the insets through the tokens rather than env() in place', () => {
    // Same rule the colour tokens follow: one file owns the source of a value.
    const candidates = STYLESHEETS.filter((file) => file.relativePath !== 'theme/tokens.css');
    expect(offences(candidates, /env\(\s*safe-area-inset/)).toEqual([]);
  });

  it('sizes the shell against the viewport that is actually visible', () => {
    const shell = sheet('shell/AppShell.module.css');
    // A mobile browser measures vh against the viewport it has with the URL
    // bar retracted, so a 100vh shell hides its own bottom - which is the
    // whole of the nav - behind the URL bar. dvh tracks the visible box.
    expect(shell).toMatch(/height:\s*100vh/);
    expect(shell).toMatch(/height:\s*100dvh/);
    // vw counts the scrollbar gutter, which is a horizontal overflow.
    expect(declarations(shell)).not.toMatch(/:\s*100vw/);
  });

  it('never floors the shell above the height of a phone held sideways', () => {
    // A landscape phone is 375-430px tall. A min-height floor put the shelf
    // below the bottom of an overflow:hidden shell, where no gesture reached
    // it and the game could not be navigated at all.
    expect(declarations(sheet('shell/AppShell.module.css'))).not.toMatch(/min-height/);
  });

  it('insets the chrome by what the shelf occupies, not by its height', () => {
    // --shelf-inset is --shelf-height plus the home indicator. Anything that
    // insets by the height alone leaves its last row under the indicator.
    const candidates = STYLESHEETS.filter((file) => file.relativePath !== 'theme/tokens.css');
    expect(offences(candidates, /var\(--shelf-height\)/)).toEqual([]);

    for (const path of ['shell/SurfaceHost.module.css', 'shell/HudOverlay.module.css'])
      expect(sheet(path)).toMatch(/inset:\s*0 0 var\(--shelf-inset\) 0/);
  });

  it('keeps the shelf clear of the home indicator', () => {
    expect(sheet('nav/Shelf.module.css')).toMatch(/--safe-bottom/);
  });

  it('lets the surface column shrink below its content', () => {
    /*
     * The bug this is here for: a flex item defaults to min-height: auto, so
     * when the surface host stacks into a column on a phone, .surface refused
     * to shrink, the archetype's own scroll container was handed its full
     * content height instead of the viewport's, and every surface ran off the
     * bottom of the screen with no way to scroll to it. On a 375x667 phone the
     * character sheet was 1579px tall inside a 499px box.
     */
    const host = sheet('shell/SurfaceHost.module.css');
    const surface = /\.surface\s*\{[^}]*\}/.exec(host)?.[0] ?? '';
    expect(surface).toMatch(/min-height:\s*0/);

    // And the host clips, so a surface that still mismeasures loses its own
    // overflow rather than painting over the nav underneath it.
    const hostRule = /\.host\s*\{[^}]*\}/.exec(host)?.[0] ?? '';
    expect(hostRule).toMatch(/overflow:\s*hidden/);
  });

  it('gives a landscape phone a shelf that fits it', () => {
    // 132px of stacked shelf is a third of a 390px-tall screen.
    expect(sheet('theme/tokens.css')).toMatch(
      /@media \(max-height: 520px\) and \(orientation: landscape\)[\s\S]*?--shelf-height/,
    );
  });

  it('sizes controls for a fingertip when the pointer is one', () => {
    expect(sheet('theme/tokens.css')).toMatch(
      /@media \(pointer: coarse\)[\s\S]*?--control-height:\s*var\(--touch-target\)/,
    );
  });

  it('keeps a focused input at the size that stops Safari zooming the page', () => {
    // Safari zooms in on a focused input under 16px and never zooms back out.
    expect(sheet('theme/tokens.css')).toMatch(/--text-input-min:\s*16px/);
    const inputs = STYLESHEETS.filter((file) => /input|search/i.test(file.text));
    for (const file of inputs) {
      if (!/\.search\s*\{/.test(file.text)) continue;
      expect(file.text).toMatch(/font-size:\s*var\(--text-input-min\)/);
    }
  });

  it('treats a tap as a tap', () => {
    // No 300ms double-tap wait, no grey flash, and a drag across the shelf or
    // the spell tree is a gesture rather than a text selection.
    const reset = sheet('theme/reset.css');
    expect(reset).toMatch(/touch-action:\s*manipulation/);
    expect(reset).toMatch(/-webkit-tap-highlight-color:\s*transparent/);
    expect(reset).toMatch(/user-select:\s*none/);
    // A swipe past the end of a panel must not drag the page over the game.
    expect(reset).toMatch(/overscroll-behavior:\s*none/);
  });
});
