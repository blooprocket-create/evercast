import { describe, expect, it } from 'vitest';
import Decimal from 'break_eternity.js';
import { MAX_DISPLAY_WIDTH, big, encodeBig, formatBig } from './numbers';

/**
 * A ladder across every representation break_eternity uses: ordinary doubles,
 * layer-1 scientific, layer-2/3 double-exponentials, and the tetration range.
 */
const LADDER: Decimal[] = [
  big(0),
  big(1),
  big('999.994'),
  big(1000),
  big('12345.6'),
  big(999_999),
  big(1e6),
  big('1.84e8'),
  big(1e15),
  big('9.9e99'),
  big('1.79e308'),
  big('1e1000'),
  big('1e100000'),
  big('1e999999'),
  big('1e1000000'),
  Decimal.pow(10, '1e30'),
  Decimal.pow(10, '1.79e308'),
  Decimal.tetrate(10, 5),
  Decimal.tetrate(10, 100),
  Decimal.tetrate(10, 1e15),
];

describe('formatBig', () => {
  it('never exceeds the display width, at any magnitude', () => {
    for (const value of LADDER) {
      const out = formatBig(value);
      expect(
        out.length,
        `${encodeBig(value)} formatted as "${out}" (${out.length} chars)`,
      ).toBeLessThanOrEqual(MAX_DISPLAY_WIDTH);
    }
  });

  it('holds the width for negatives too', () => {
    for (const value of LADDER) {
      const out = formatBig(value.neg());
      expect(out.length, `formatted as "${out}"`).toBeLessThanOrEqual(MAX_DISPLAY_WIDTH);
    }
  });

  it('never emits a placeholder, NaN or raw Infinity', () => {
    for (const value of LADDER) {
      const out = formatBig(value);
      expect(out).not.toMatch(/NaN|Infinity|undefined|null/);
      expect(out.length).toBeGreaterThan(0);
    }
  });

  it('is deterministic', () => {
    for (const value of LADDER) {
      expect(formatBig(value)).toBe(formatBig(big(encodeBig(value))));
    }
  });

  it('keeps distinct magnitudes distinguishable', () => {
    const seen = new Map<string, string>();
    for (const value of LADDER) {
      const out = formatBig(value);
      const previous = seen.get(out);
      expect(previous, `"${out}" collides: ${previous} vs ${encodeBig(value)}`).toBeUndefined();
      seen.set(out, encodeBig(value));
    }
  });

  it('covers every band', () => {
    // A: plain, B: grouped, C/D: scientific, E: double-exponential, F: tetration
    expect(formatBig(big('999.994'))).toBe('999.99');
    expect(formatBig(big(999_999))).toBe('999,999');
    expect(formatBig(big('1.84e8'))).toMatch(/^\d(\.\d+)?e8$/);
    expect(formatBig(Decimal.pow(10, '1.79e308'))).toMatch(/^ee/);
    expect(formatBig(Decimal.tetrate(10, 1e15))).toMatch(/^F/);
  });

  it('reads as an ordinary number below a million', () => {
    expect(formatBig(big(0))).toBe('0');
    expect(formatBig(big(25))).toBe('25');
    expect(formatBig(big('1.5'))).toBe('1.5');
    expect(formatBig(big(184_200))).toBe('184,200');
  });
});
