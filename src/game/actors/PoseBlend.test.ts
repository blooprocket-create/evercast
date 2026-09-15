import { describe, expect, it } from 'vitest';
import { CROSS_FADE, crossFadeWeight, impulseAmount, impulseStrength } from './PoseBlend';

describe('crossFadeWeight', () => {
  it('starts wholly on the old pose and ends wholly on the new one', () => {
    expect(crossFadeWeight(0.1, 0.1)).toBe(1);
    expect(crossFadeWeight(0, 0.1)).toBe(0);
  });

  it('is exactly zero once spent, not merely small', () => {
    // A settled actor has to be bit-for-bit the clip. An epsilon of a pose it
    // used to be holding would never wash out, because nothing else clears it.
    expect(crossFadeWeight(-0.004, 0.1)).toBe(0);
    expect(crossFadeWeight(0, 0)).toBe(0);
    expect(crossFadeWeight(0.05, 0)).toBe(0);
  });

  it('eases in and out rather than running linearly', () => {
    // A linear blend has a velocity step at both ends, which on a limb is two
    // small pops in place of the one the cross-fade was there to remove.
    const half = crossFadeWeight(0.05, 0.1);
    expect(half).toBeCloseTo(0.5, 5);
    // Flat near both ends: the first and last tenth move much less than the
    // middle tenth does.
    const nearEnd = crossFadeWeight(0.01, 0.1) - crossFadeWeight(0, 0.1);
    const middle = crossFadeWeight(0.055, 0.1) - crossFadeWeight(0.045, 0.1);
    expect(middle).toBeGreaterThan(nearEnd * 3);
  });

  it('falls the whole way and never turns back', () => {
    let previous = crossFadeWeight(0.1, 0.1);
    for (let remaining = 0.1; remaining >= 0; remaining -= 0.005) {
      const weight = crossFadeWeight(remaining, 0.1);
      expect(weight).toBeLessThanOrEqual(previous + 1e-9);
      expect(weight).toBeGreaterThanOrEqual(0);
      expect(weight).toBeLessThanOrEqual(1);
      previous = weight;
    }
  });

  it('clamps a blend that outlives its own budget', () => {
    // `start` can be called again before the previous fade is spent, which
    // leaves `remaining` briefly larger than the new `total`.
    expect(crossFadeWeight(0.3, 0.1)).toBe(1);
  });
});

describe('CROSS_FADE', () => {
  it('makes a flinch the most abrupt transition and settling the least', () => {
    expect(CROSS_FADE.hit).toBeLessThan(CROSS_FADE.attack);
    expect(CROSS_FADE.idle).toBeGreaterThan(CROSS_FADE.walk);
    expect(CROSS_FADE.idle).toBeGreaterThan(CROSS_FADE.attack);
  });

  it('stays under a fifth of a second, so nothing reads as slow', () => {
    for (const [state, seconds] of Object.entries(CROSS_FADE)) {
      expect(seconds, state).toBeGreaterThan(0);
      expect(seconds, state).toBeLessThan(0.2);
    }
  });
});

describe('impulseAmount', () => {
  it('rests at zero at both ends', () => {
    // Anything else leaves an actor permanently off its own feet: the hinge is
    // written every frame the impulse runs and never corrected afterwards.
    expect(impulseAmount(0)).toBe(0);
    expect(impulseAmount(1)).toBe(0);
    expect(impulseAmount(1.5)).toBe(0);
    expect(impulseAmount(-0.2)).toBe(0);
  });

  it('throws the body out hard and early', () => {
    const peak = impulseAmount(0.2);
    expect(peak).toBeGreaterThan(0.5);
    expect(peak).toBeGreaterThan(impulseAmount(0.5));
    expect(impulseAmount(0.05)).toBeGreaterThan(0);
  });

  it('overshoots back through zero on the return', () => {
    // The overshoot is the difference between a body absorbing a blow and a
    // body being translated by one; a fade back to rest has neither.
    const late = impulseAmount(0.8);
    expect(late).toBeLessThan(0);
    expect(Math.abs(late)).toBeLessThan(impulseAmount(0.2));
  });

  it('never throws further than the strength it was given', () => {
    for (let t = 0; t <= 1; t += 0.01) expect(Math.abs(impulseAmount(t))).toBeLessThanOrEqual(1);
  });

  it('damps, so the rebound is smaller than the blow', () => {
    expect(Math.abs(impulseAmount(0.9))).toBeLessThan(Math.abs(impulseAmount(0.7)));
  });
});

describe('impulseStrength', () => {
  it('rocks a body harder on a critical', () => {
    expect(impulseStrength({ critical: true })).toBeGreaterThan(impulseStrength({}));
  });

  it('barely moves a boss', () => {
    // A boss that staggered like a slime would read as weightless, and it is
    // on screen for far longer than anything else in the fight.
    expect(impulseStrength({ boss: true })).toBeLessThan(impulseStrength({}) * 0.5);
    expect(impulseStrength({ critical: true, boss: true })).toBeLessThan(impulseStrength({}));
    expect(impulseStrength({ boss: true })).toBeGreaterThan(0);
  });

  it('stays small enough to be a flinch rather than a knockback', () => {
    // These are metres on the hinge. The enemies stand about a metre apart.
    expect(impulseStrength({ critical: true })).toBeLessThan(0.35);
  });
});
