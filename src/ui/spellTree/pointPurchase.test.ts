import { describe, expect, it } from 'vitest';
import { spellPointOffer } from './pointPurchase';

const offer = (over: Partial<Parameters<typeof spellPointOffer>[0]> = {}) =>
  spellPointOffer({
    totalPoints: 3,
    maxPoints: 10,
    cost: '100',
    essence: '100',
    essencePerSecond: '1',
    ...over,
  });

describe('spell point offer', () => {
  it('offers the point when it is both affordable and available', () => {
    expect(offer()).toEqual({ affordable: true, wait: 'Affordable now' });
  });

  it('prices the wait when the essence is short', () => {
    expect(offer({ essence: '40' })).toEqual({ affordable: false, wait: 'in 1m' });
  });

  it('says nothing about time at the cap, however much essence is banked', () => {
    // The bug this exists for: the button was disabled for want of a point and
    // the label beside it said "Affordable now" about the essence.
    expect(offer({ totalPoints: 10, essence: '1e40' })).toEqual({
      affordable: false,
      wait: null,
    });
  });

  it('holds at the cap even past it', () => {
    expect(offer({ totalPoints: 11, maxPoints: 10 })).toEqual({ affordable: false, wait: null });
  });

  it('has nothing to say while the meter is cold', () => {
    expect(offer({ essence: '40', essencePerSecond: null })).toEqual({
      affordable: false,
      wait: null,
    });
  });
});
