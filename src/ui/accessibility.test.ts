import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * WCAG 2.2 AA, enforced the same way the design rules already are: as
 * assertions over the source, in the suite that runs on every pull request.
 *
 * These are the rules that were being broken rather than a full checklist -
 * `src/ui/architecture.test.ts` kept every colour in one sheet, which made the
 * contrast failures fixable in one place, and also made them easy to reach from
 * here. What this cannot check is anything needing a rendered page and a real
 * assistive technology; that stays a human job.
 */

const UI_ROOT = join(process.cwd(), 'src', 'ui');
const TOKENS = readFileSync(join(UI_ROOT, 'theme', 'tokens.css'), 'utf8');
const RESET = readFileSync(join(UI_ROOT, 'theme', 'reset.css'), 'utf8');

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
    if (!/\.(ts|tsx|css)$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
    files.push({
      relativePath: relative(UI_ROOT, path).split(sep).join('/'),
      text: readFileSync(path, 'utf8'),
    });
  }
  return files;
}

const FILES = collect(UI_ROOT);

/** The value of a custom property declared in tokens.css. */
function token(name: string): string {
  const match = TOKENS.match(new RegExp(`^\\s*--${name}:\\s*([^;]+);`, 'm'));
  if (!match) throw new Error(`tokens.css declares no --${name}`);
  return match[1].trim();
}

function channels(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? [...value].map((c) => c + c).join('') : value;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

/** Relative luminance, per WCAG 2.x. */
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const [a, b] = [luminance(foreground), luminance(background)];
  const [high, low] = a > b ? [a, b] : [b, a];
  return (high + 0.05) / (low + 0.05);
}

/** The three surfaces anything in this UI can be drawn on. */
const SURFACES = ['bg', 'panel', 'raised'] as const;

describe('contrast (WCAG 1.4.3, AA)', () => {
  /**
   * Every token the UI sets as a `color`, against every surface it can land on.
   *
   * `--ink-dim` used to fail this at 3.15:1 on `--raised` while being the text
   * colour of eighteen surfaces, and the Gravehollow accent failed it at 3.20:1
   * on every screen the player sees in that biome. The smallest type step here
   * is 10px, so the large-text allowance of 3:1 never applies: 4.5 is the bar
   * for all of it.
   */
  const TEXT_TOKENS = [
    'ink',
    'ink-mid',
    'ink-low',
    'ink-dim',
    'ink-num',
    'gold',
    'essence',
    'hp-you',
    'hp-foe',
    'crit',
    'route',
    'accent-ink-greenfields',
    'accent-ink-whispering-woods',
    'accent-ink-gravehollow',
    'accent-ink-ashen-road',
  ];

  for (const name of TEXT_TOKENS) {
    it(`--${name} reaches 4.5:1 on every surface`, () => {
      for (const surface of SURFACES) {
        expect(contrast(token(name), token(surface)), `--${name} on --${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  /**
   * The authored biome accents are held to the lower bar on purpose: they are
   * borders, meter fills and dots, which owe 3:1 under WCAG 1.4.11 rather than
   * 4.5:1 under 1.4.3. The `--accent-ink-*` set above is what text uses.
   */
  for (const name of ['accent-greenfields', 'accent-whispering-woods', 'accent-gravehollow', 'accent-ashen-road']) {
    it(`--${name} reaches 3:1 on every surface as a non-text colour`, () => {
      for (const surface of SURFACES) {
        expect(contrast(token(name), token(surface)), `--${name} on --${surface}`).toBeGreaterThanOrEqual(3);
      }
    });
  }

  it('sets no accent as a text colour, which would bring the authored value back', () => {
    const offences = FILES.filter((file) => /color:\s*var\(--accent\)/.test(file.text)).map(
      (file) => file.relativePath,
    );
    expect(offences).toEqual([]);
  });
});

describe('focus (WCAG 2.4.7 and 2.4.11, AA)', () => {
  it('gives every focusable a visible indicator by default', () => {
    expect(RESET).toMatch(/:focus-visible\s*\{[^}]*outline:/);
    expect(RESET).toContain('var(--focus)');
  });

  it('draws the ring clear of the control, so it is never inside a filled one', () => {
    expect(RESET).toMatch(/outline-offset:\s*[1-9]/);
  });

  it('keeps the focus colour at 3:1 against every surface', () => {
    for (const surface of SURFACES) {
      expect(contrast(token('focus'), token(surface)), surface).toBeGreaterThanOrEqual(3);
    }
  });

  it('scrolls a focused control into view rather than leaving it under the shelf', () => {
    expect(RESET).toMatch(/scroll-margin:/);
  });
});

describe('tab order (WCAG 2.4.3, A)', () => {
  /**
   * Babylon defaults the rendering canvas to `tabIndex = 1`, and a positive
   * tabindex jumps the queue rather than joining it: the diorama came before
   * every button on the page, as a focus stop that does nothing. It cannot be
   * fixed on the element, because Babylon re-asserts it from its pointer-move
   * handler - it has to be the engine option, which is why this checks for the
   * option rather than for the attribute.
   */
  it('keeps the Babylon canvas out of the sequential tab order', () => {
    const scene = readFileSync(join(process.cwd(), 'src', 'game', 'EvercastScene.ts'), 'utf8');
    expect(scene).toMatch(/canvasTabIndex:\s*-1/);
  });

  it('sets no positive tabindex anywhere in the interface', () => {
    const offences = FILES.filter((file) => /tabIndex=\{[1-9]/.test(file.text)).map(
      (file) => file.relativePath,
    );
    expect(offences).toEqual([]);
  });
});

describe('motion (WCAG 2.3.3)', () => {
  it('honours prefers-reduced-motion across the whole interface', () => {
    expect(RESET).toContain('@media (prefers-reduced-motion: reduce)');
  });
});

describe('dialogs (WCAG 2.1.2 and 2.4.3)', () => {
  /**
   * `aria-modal` is a claim about focus, and for most of this UI's life nothing
   * enforced it: a keyboard player could Tab out of an "Erase this run?"
   * confirmation into the shelf behind it. So anything making the claim has to
   * carry a mechanism, and there are exactly three that count here:
   *
   *   `useDialog`  takes focus, cycles it and gives it back - the general case
   *   `inert`      makes everything else unfocusable, which is what `AppShell`
   *                does around the boot gate
   *   `.focus()`   moves focus in, which is enough when an `inert` sibling has
   *                already left nothing else to move to - the boot gate again
   *
   * A component doing none of the three is the bug this catches.
   */
  it('backs every aria-modal with something that actually manages focus', () => {
    const claiming = FILES.filter(
      (file) => /aria-modal/.test(file.text) && file.relativePath !== 'shell/useDialog.ts',
    );
    expect(claiming.length).toBeGreaterThan(0);
    for (const file of claiming) {
      expect(file.text, `${file.relativePath} sets aria-modal`).toMatch(
        /useDialog|inert|\.focus\(\)/,
      );
    }
  });

  /**
   * The other half: `AppShell` is what makes the boot gate's claim true, and it
   * is one attribute away from silently not doing so.
   */
  it('keeps the world behind the boot gate unfocusable', () => {
    const shell = FILES.find((file) => file.relativePath === 'shell/AppShell.tsx');
    expect(shell?.text).toMatch(/inert=\{!playing\}/);
  });
});
