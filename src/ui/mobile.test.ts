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

/**
 * The body of the first `@media` whose query contains `query`, braces matched
 * rather than guessed - a media block holds rules, so the lazy `[^}]*` the
 * single-rule helpers use stops at the first nested `}`.
 */
function mediaBlock(css: string, query: string): string {
  const start = css.indexOf(`@media ${query}`);
  if (start === -1) throw new Error(`no @media ${query}`);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated @media ${query}`);
}

/** The body of the first rule whose selector is exactly `selector`. */
function rule(css: string, selector: string): string {
  const found = new RegExp(`(^|\\n)\\s*${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(css);
  if (!found) throw new Error(`no rule for ${selector}`);
  return found[2];
}

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

  it('clears the notch above the only way out of a surface', () => {
    /*
     * viewport-fit=cover puts the top of the host at the physical top of the
     * display. The header holds Back, and on a 393x852 iPhone with a 59px
     * Dynamic Island the button measured y=8..52 - covered end to end by the
     * system area, with no other way to close a surface.
     */
    const host = /\.host\s*\{[^}]*\}/.exec(sheet('shell/SurfaceHost.module.css'))?.[0] ?? '';
    expect(host).toMatch(/padding-top:\s*var\(--safe-top\)/);
  });

  it('claims the wide landscape layout only where it is actually wide', () => {
    /*
     * Keyed on height alone, the landscape rule turned the host into three
     * columns on a 320x568 phone held sideways too: 568px across a rail, a
     * list and a pane left the pane 104px with 130px of its content clipped
     * by overflow-x: hidden and unreachable - the same defect this whole
     * change set out to remove. Any rule that builds those columns has to
     * say how much width it needs.
     *
     * tokens.css and HudOverlay are exempt on purpose: the shelf and the HUD
     * only ever need one row, so they hold at any width.
     */
    const columnBuilders = [
      'shell/SurfaceHost.module.css',
      'nav/NavRail.module.css',
      'archetypes/Detail.module.css',
      'archetypes/Graph.module.css',
      'archetypes/Dashboard.module.css',
    ];
    for (const path of columnBuilders) {
      const queries = sheet(path).match(/@media[^{]*orientation:\s*landscape[^{]*\{/g) ?? [];
      expect(queries.length).toBeGreaterThan(0);
      for (const query of queries) expect(`${path} ${query}`).toMatch(/min-width:/);
    }
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

  it('takes the wallet labels out of the line, but not out of the page', () => {
    /*
     * The threshold was 360px when the header carried two wallets. Starlight
     * made it three, and between 361 and 420 the third was pushed clean off
     * the right edge - label, value and all - because `.wallets` is `flex:
     * none` and widens the header rather than shrinking. Every phone in
     * portrait is inside that band, so the labels have to stop taking width.
     *
     * This used to assert `display: none`, and that was the wrong rule: it
     * left three currencies told apart by a 7px dot in each one's own colour,
     * which is WCAG 1.4.1 on the number every purchase is judged against - and
     * `display: none` took the word from assistive technology as well, so a
     * screen reader got three bare numbers. The label is clipped instead, and
     * a glyph carries the meaning on screen.
     */
    const host = sheet('shell/SurfaceHost.module.css');
    const query = /@media \(max-width: (\d+)px\)\s*\{\s*\.walletLabel\s*\{([^}]*)\}/.exec(
      declarations(host),
    );
    expect(query, 'no rule takes .walletLabel out of the line at a narrow width').not.toBeNull();
    expect(Number(query?.[1])).toBeGreaterThanOrEqual(430);

    const rule = query?.[2] ?? '';
    expect(rule, 'the label must still reach a screen reader').not.toMatch(/display:\s*none/);
    expect(rule).toMatch(/clip-path:\s*inset\(/);
    expect(rule).toMatch(/position:\s*absolute/);

    // And if a fourth ever arrives it clips rather than dragging the host wide.
    const hostRule = /\.header\s*\{[^}]*\}/.exec(host)?.[0] ?? '';
    expect(hostRule).toMatch(/overflow:\s*hidden/);
  });

  it('never leaves a wallet told apart by colour alone', () => {
    /*
     * The sub-560px fallback was a `::before` dot filled with `currentColor`.
     * Shape, not hue, is what makes three numbers distinguishable.
     */
    const host = sheet('shell/SurfaceHost.module.css');
    expect(declarations(host)).not.toMatch(/\.walletItem::before/);
  });

  it('gives the summon overlay a definite column to measure against', () => {
    /*
     * Left implicit, the scrim's grid column sized to max-content - the width
     * all ten cards would like, measured at 855px inside a 375px phone - and
     * every child asking for 100% inherited that instead of the screen. The
     * card grid laid out nine columns, clipped six of them, and took the
     * Continue button off the right edge with them.
     */
    const reveal = sheet('summon/SummonReveal.module.css');
    const scrim = /\.scrim\s*\{[^}]*\}/.exec(declarations(reveal))?.[0] ?? '';
    expect(scrim).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    // Centring a batch taller than the screen must not strand its first row
    // above the top of the scroll container.
    expect(scrim).toMatch(/align-content:\s*safe center/);
  });

  it('never sets a grid track minimum wider than the narrowest phone', () => {
    /*
     * `minmax(9rem, 1fr)` is 144px that cannot shrink, so a row of them
     * overflows a 320px screen instead of wrapping. `min(100%, 9rem)` says
     * "9rem, or the whole width if that is less", which is what makes
     * auto-fit behave on a phone.
     */
    const candidates = STYLESHEETS.filter((file) => file.relativePath !== 'theme/tokens.css');
    const bare = offences(candidates, /minmax\(\s*\d+(\.\d+)?rem/);
    expect(bare).toEqual([]);
  });

  it('lays the top chrome out in flow on a phone', () => {
    /*
     * `.place` and `.wallets` are the two top corners, and absolutely
     * positioned neither could see the other. The strip was pinned by its right
     * edge with nothing bounding its left, so it grew off the side of the
     * screen the moment anything joined it: Retry Frontier stands beside the
     * wallets for the whole of a farming run, and with it there the strip
     * measured 455px on a 390px phone, drawing Gold at x = -65.
     *
     * `.place` then cleared it by a hardcoded 62px - a guess at the strip's
     * height rather than a measurement - so a strip that wrapped went straight
     * through the wordmark.
     */
    const phone = mediaBlock(sheet('shell/HudOverlay.module.css'), '(max-width: 860px)');
    /*
     * `relative`, not `static`. `.chrome::before` is the HUD fade and it is
     * absolutely positioned, so a positioned descendant paints above it and an
     * in-flow one does not: made static, these two sat under their own
     * 60%-opaque gradient and the wordmark, Frontier, Best and the mode pill
     * all lost contrast against a sky the tokens already call marginal.
     * Relative is still in flow - the column lays them out either way.
     */
    expect(declarations(phone)).toMatch(
      /\.place,\s*\n\s*\.wallets\s*\{[^}]*position:\s*relative[^}]*inset:\s*auto/,
    );
    // No offset reserving room for a box whose height nobody measured.
    for (const selector of ['.place', '.wallets'])
      expect(declarations(rule(phone, selector))).not.toMatch(/(^|\s)(top|left|right):/);
  });

  it('gives every wallet in the strip the same face', () => {
    /*
     * The font was on `.gold` and `.essence`; `.starlight` arrived later and
     * set only a colour, so the third wallet drew its number in the inherited
     * 16px Inter beside two in 17px Georgia. A `ch` resolves against the
     * element's own font, so it also reserved 102px where the others reserved
     * 85 - the odd one out was the widest item in a strip that did not fit.
     */
    const hud = declarations(sheet('shell/HudOverlay.module.css'));
    expect(rule(hud, '.walletItem')).toMatch(/font:\s*\d+\s+var\(--text-[a-z]+\)/);
    for (const selector of ['.gold', '.essence', '.starlight'])
      expect(`${selector} ${rule(hud, selector)}`).not.toMatch(/font/);
  });

  it('lets a moment scroll rather than cutting its card off', () => {
    /*
     * The premise is the first thing a new player sees and it measures 582px on
     * a 320x568 phone. The scrim centred it and clipped it: the last 38px were
     * off the bottom of the display with nothing to scroll to them.
     *
     * `safe` rather than plain `center`, or a card that overflows is stranded
     * above the scroll origin instead - the same trap SummonReveal's scrim
     * already names. On the base rule, not a media query: a short viewport is
     * not a landscape-only condition.
     */
    const scrim = rule(declarations(sheet('archetypes/Moment.module.css')), '.scrim');
    expect(scrim).toMatch(/overflow-y:\s*auto/);
    expect(scrim).toMatch(/align-content:\s*safe center/);
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
