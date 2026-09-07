import { describe, expect, it } from 'vitest';
import { sampleBiome } from './WorldGenerator';

describe('procedural world biome sampling', () => {
  it('starts in Greenfields and blends into Whispering Woods near the boundary', () => {
    expect(sampleBiome(0)).toEqual({ from: 'greenfields', to: 'greenfields', t: 0 });
    const transition = sampleBiome(60);
    expect(transition.from).toBe('greenfields');
    expect(transition.to).toBe('whispering_woods');
    expect(transition.t).toBeGreaterThan(0);
    expect(transition.t).toBeLessThan(1);
  });

  it('cycles from Whispering Woods into Gravehollow and back to Greenfields', () => {
    const graveTransition = sampleBiome(132);
    expect(graveTransition.from).toBe('whispering_woods');
    expect(graveTransition.to).toBe('gravehollow');

    const cycleTransition = sampleBiome(204);
    expect(cycleTransition.from).toBe('gravehollow');
    expect(cycleTransition.to).toBe('greenfields');
    expect(sampleBiome(216)).toEqual(sampleBiome(0));
  });
});
