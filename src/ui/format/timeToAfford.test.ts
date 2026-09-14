import { describe, expect, it } from 'vitest';
import { affordabilityLabel, formatWait, timeToAfford } from './timeToAfford';

describe('how long until it is affordable', () => {
  it('says now when the money is already there', () => {
    expect(timeToAfford('100', '100', '5')).toEqual({ now: true, seconds: 0 });
    expect(timeToAfford('100', '1e9', '5')).toEqual({ now: true, seconds: 0 });
  });

  it('divides the gap by the rate', () => {
    expect(timeToAfford('100', '40', '2').seconds).toBe(30);
  });

  it('works at the magnitudes the game actually reaches', () => {
    // A real pair from the late save: a 5.92e50 gear level against 1.21e47.
    const answer = timeToAfford('5.92e50', '1.21e47', '4e48');
    expect(answer.seconds).toBeGreaterThan(147);
    expect(answer.seconds).toBeLessThan(149);
  });

  it('says nothing rather than something made up', () => {
    // No meter yet, nothing being earned, and a wait past any useful horizon.
    expect(timeToAfford('100', '0', null).seconds).toBeNull();
    expect(timeToAfford('100', '0', undefined).seconds).toBeNull();
    expect(timeToAfford('100', '0', '0').seconds).toBeNull();
    expect(timeToAfford('100', '0', '-5').seconds).toBeNull();
    expect(timeToAfford('1e300', '0', '1').seconds).toBeNull();
  });
});

describe('the wait itself', () => {
  it('reads as two fields at most', () => {
    expect(formatWait(0)).toBe('0s');
    expect(formatWait(9.2)).toBe('10s');
    expect(formatWait(59)).toBe('59s');
    expect(formatWait(60)).toBe('1m');
    expect(formatWait(95)).toBe('1m 35s');
    expect(formatWait(3600)).toBe('1h');
    expect(formatWait(3660)).toBe('1h 1m');
    expect(formatWait(86_400)).toBe('1d');
    expect(formatWait(90_000)).toBe('1d 1h');
  });

  it('never prints a field that is zero', () => {
    // `3h 0m` reads as a rounding artefact rather than as three hours.
    for (let seconds = 0; seconds < 200_000; seconds += 37) {
      expect(formatWait(seconds)).not.toMatch(/\b0[smhd]\b(?!$)/);
    }
  });

  it('rounds up, so a wait never reads as already over', () => {
    expect(formatWait(0.1)).toBe('1s');
    expect(formatWait(59.5)).toBe('1m');
  });
});

describe('the label', () => {
  it('is a phrase, or nothing', () => {
    expect(affordabilityLabel('100', '100', '1')).toBe('Affordable now');
    expect(affordabilityLabel('100', '40', '2')).toBe('in 30s');
    expect(affordabilityLabel('100', '40', null)).toBeNull();
  });
});
