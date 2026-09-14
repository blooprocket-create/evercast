import { describe, expect, it } from 'vitest';
import { formatAwayTime } from './awayTime';

/**
 * The table from the audit's TXT-2, as a test. Every row on the left is a span
 * the old formatter rendered wrongly; the right column is what it should have
 * said. The boundary rows are the point - rounding is what put "60 minutes"
 * and "1h 60m" on screen.
 */
describe('formatAwayTime', () => {
  it.each([
    [0, 'less than a minute'],
    [5, 'less than a minute'],
    [29, 'less than a minute'],
    [30, 'less than a minute'],
    [59, 'less than a minute'],
    [60, '1 minute'],
    [89, '1 minute'],
    [90, '1 minute'],
    [120, '2 minutes'],
    [3540, '59 minutes'],
    [3570, '59 minutes'],
    [3599, '59 minutes'],
    [3600, '1h 0m'],
    [3660, '1h 1m'],
    [7190, '1h 59m'],
    [7200, '2h 0m'],
    [86_340, '23h 59m'],
    [86_399, '23h 59m'],
    [86_400, '1d 0h'],
    [90_000, '1d 1h'],
    [172_800, '2d 0h'],
  ])('renders %i seconds as %s', (seconds, expected) => {
    expect(formatAwayTime(seconds)).toBe(expected);
  });

  it('never lets a field reach the ceiling of the unit above it', () => {
    for (let seconds = 0; seconds < 3 * 24 * 60 * 60; seconds += 7) {
      const text = formatAwayTime(seconds);
      expect(text).not.toMatch(/\b60m\b/);
      expect(text).not.toMatch(/\b60 minutes\b/);
      expect(text).not.toMatch(/\b24h\b/);
      expect(text).not.toMatch(/\b0 minutes\b/);
      expect(text).not.toMatch(/\b1 minutes\b/);
    }
  });

  it('survives a span that is not a number', () => {
    expect(formatAwayTime(Number.NaN)).toBe('less than a minute');
    expect(formatAwayTime(-1)).toBe('less than a minute');
    expect(formatAwayTime(Number.POSITIVE_INFINITY)).toBe('less than a minute');
  });
});
