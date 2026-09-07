import { describe, expect, it } from 'vitest';
import { sampleBiome, sampleTransitionProfile } from './WorldGenerator';

describe('procedural world biome sampling', () => {
  it('starts in Greenfields and blends gradually into Whispering Woods', () => {
    expect(sampleBiome(0)).toEqual({ from: 'greenfields', to: 'greenfields', t: 0 });

    const early = sampleBiome(60);
    const middle = sampleBiome(84);
    const late = sampleBiome(108);
    expect(early.from).toBe('greenfields');
    expect(early.to).toBe('whispering_woods');
    expect(early.t).toBeGreaterThan(0);
    expect(middle.t).toBeGreaterThan(early.t);
    expect(late.t).toBeGreaterThan(middle.t);
    expect(late.t).toBeLessThan(1);
  });

  it('cycles from Whispering Woods into Gravehollow and back to Greenfields', () => {
    const graveTransition = sampleBiome(204);
    expect(graveTransition.from).toBe('whispering_woods');
    expect(graveTransition.to).toBe('gravehollow');

    const cycleTransition = sampleBiome(324);
    expect(cycleTransition.from).toBe('gravehollow');
    expect(cycleTransition.to).toBe('greenfields');
    expect(sampleBiome(360)).toEqual(sampleBiome(0));
  });

  it('staggers environmental systems instead of crossfading every layer together', () => {
    const earlyTransition = sampleTransitionProfile(66);
    expect(earlyTransition.background).toBeGreaterThan(earlyTransition.ground);
    expect(earlyTransition.sky).toBeGreaterThan(earlyTransition.props);
    expect(earlyTransition.props).toBeGreaterThanOrEqual(earlyTransition.fog);
    expect(earlyTransition.fog).toBeGreaterThanOrEqual(earlyTransition.motes);

    const lateTransition = sampleTransitionProfile(114);
    expect(lateTransition.background).toBeGreaterThan(0.95);
    expect(lateTransition.ground).toBeGreaterThan(0.9);
    expect(lateTransition.props).toBeGreaterThan(0.85);
    expect(lateTransition.fog).toBeGreaterThan(0.7);
  });
});
