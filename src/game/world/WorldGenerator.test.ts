import { describe, expect, it } from 'vitest';
import { createDefaultCatalog, resolveZone } from '../../content/catalog';
import { ZONES } from '../../content/zones';
import { DEFAULT_ENGINE_CONFIG } from '../../engine/config';
import { initialJourneyTravelSeconds, worldTravelSpeed } from './JourneyProgress';
import { sampleBiome, sampleTransitionProfile } from './WorldGenerator';

/** Exactly what `EvercastScene.syncJourney` walks the world to for a stage. */
const distanceAtStage = (stage: number, zoneLength = DEFAULT_ENGINE_CONFIG.zoneLength): number =>
  initialJourneyTravelSeconds(stage) * worldTravelSpeed(zoneLength);

describe('procedural world biome sampling', () => {
  it('starts in Greenfields and blends gradually into Whispering Woods', () => {
    expect(sampleBiome(0)).toEqual({ from: 'greenfields', to: 'greenfields', t: 0 });

    // These distances describe the current visual-test tuning, not final game canon.
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

  it('cycles through every authored zone, in their order, and wraps', () => {
    // Three biomes against four zones is what made the interface and the
    // terrain name different places; the cycle is the zone list now.
    const arrivals = ZONES.map((zone, index) => ({
      zone: zone.id,
      sample: sampleBiome(index * 120),
    }));
    for (const { zone, sample } of arrivals) {
      expect(sample.from).toBe(zone);
      expect(sample.t).toBe(0);
    }
    expect(sampleBiome(120 * ZONES.length)).toEqual(sampleBiome(0));
  });

  it('renders the zone the HUD is naming, at every stage of a long run', () => {
    /*
     * The one assertion this whole change exists for. Observed before it, at
     * stage 766: `Gravehollow` in the corner of the screen, in purple, over
     * bright green Greenfields grass with gravestones scattered through it.
     *
     * Both sides are computed the way the game computes them - the zone from
     * `resolveZone`, the distance from the same journey constants
     * `syncJourney` walks the world by - so this fails if either clock is
     * changed without the other.
     */
    const catalog = createDefaultCatalog();
    for (let stage = 1; stage <= 420; stage += 1) {
      const zone = resolveZone(catalog, stage, DEFAULT_ENGINE_CONFIG.zoneLength).zone;
      const rendered = sampleBiome(distanceAtStage(stage));
      expect(rendered.from, `stage ${stage}`).toBe(zone.id);
    }
  });

  it('renders the named zone at a zone length the default config does not use', () => {
    /*
     * The same assertion, off the default. The speed used to be a module
     * constant computed from `DEFAULT_ENGINE_CONFIG`, so a run configured with
     * any other `zoneLength` put the interface back on one clock and the road
     * on another - the exact drift the test above exists to prevent, reachable
     * by changing a single number. Both are read from the run now.
     */
    const catalog = createDefaultCatalog();
    for (const zoneLength of [10, 40]) {
      for (let stage = 1; stage <= 420; stage += 1) {
        const zone = resolveZone(catalog, stage, zoneLength).zone;
        const rendered = sampleBiome(distanceAtStage(stage, zoneLength));
        expect(rendered.from, `zoneLength ${zoneLength}, stage ${stage}`).toBe(zone.id);
      }
    }
  });

  it('spends the first part of a zone settled in it before drifting to the next', () => {
    // A transition that began at the boundary would mean no zone ever looked
    // like itself; one that never began would mean arriving without warning.
    const settled = sampleBiome(distanceAtStage(30));
    expect(settled.t).toBe(0);
    const drifting = sampleBiome(distanceAtStage(45));
    expect(drifting.from).toBe('whispering_woods');
    expect(drifting.to).toBe('gravehollow');
    expect(drifting.t).toBeGreaterThan(0);
    expect(drifting.t).toBeLessThan(1);
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
