import { describe, expect, it } from 'vitest';
import { formatRunClock } from './runClock';

describe('the run clock', () => {
  it('reads as minutes and seconds inside the first hour', () => {
    expect(formatRunClock(0)).toBe('0:00');
    expect(formatRunClock(7)).toBe('0:07');
    expect(formatRunClock(70)).toBe('1:10');
    expect(formatRunClock(3599)).toBe('59:59');
  });

  it('grows an hours field only once there are hours', () => {
    expect(formatRunClock(3600)).toBe('1:00:00');
    expect(formatRunClock(3663)).toBe('1:01:03');
    // An offline settle can be days; it stays one field rather than inventing one.
    expect(formatRunClock(90_061)).toBe('25:01:01');
  });

  it('pads every field below the largest, and none above it', () => {
    // `1:7:3` and `1:07:03` are different numbers to a reader.
    expect(formatRunClock(3600 + 7 * 60 + 3)).toBe('1:07:03');
    expect(formatRunClock(7 * 60 + 3)).toBe('7:03');
  });

  it('floors rather than rounds, so a stamp never precedes what it stamps', () => {
    expect(formatRunClock(59.9)).toBe('0:59');
    expect(formatRunClock(3599.999)).toBe('59:59');
  });

  it('survives the values a clock should never be given', () => {
    expect(formatRunClock(-1)).toBe('0:00');
    expect(formatRunClock(Number.NaN)).toBe('0:00');
    expect(formatRunClock(Number.POSITIVE_INFINITY)).toBe('0:00');
  });
});
