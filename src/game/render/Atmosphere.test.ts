import { describe, expect, it } from 'vitest';
import { Color3, NullEngine, PBRMaterial, Scene, StandardMaterial } from '@babylonjs/core';
import { AtmosphereState, breatheOn } from './Atmosphere';
import { environmentResponse } from '../world/EnvironmentMaterials';
import { isLuminousMaterial } from './LuminousGlow';

describe('what the wind and the sun do to a surface', () => {
  it('bends foliage and leaves everything else rigid', () => {
    expect(environmentResponse('Leaf / sunlit', 'grass_clump_a').wind).toBeGreaterThan(0);
    expect(environmentResponse('Flower / cream', 'flower_patch_a').wind).toBeGreaterThan(0);
    // Bark, stone and iron are in the same GLBs as the leaves and must not move
    // with them: a trunk that swayed would take its own canopy off its top.
    expect(environmentResponse('Bark / umber', 'healthy_tree_a').wind).toBeUndefined();
    expect(environmentResponse('Stone / pale', 'meadow_waystone').wind).toBeUndefined();
    expect(environmentResponse('Iron / cast bronze', 'vigil_lantern').wind).toBeUndefined();
  });

  it('bends a blade of grass much further than a tree', () => {
    const grass = environmentResponse('Leaf / sage', 'grass_clump_a').wind ?? 0;
    const tree = environmentResponse('Leaf / sage', 'healthy_tree_a').wind ?? 0;
    expect(tree).toBeGreaterThan(0);
    expect(grass).toBeGreaterThan(tree * 3);
  });

  it('lets light through a petal more readily than through a leaf', () => {
    const petal = environmentResponse('Flower / cream', 'flower_patch_a').translucency ?? 0;
    const leaf = environmentResponse('Leaf / fern', 'healthy_tree_a').translucency ?? 0;
    expect(petal).toBeGreaterThan(leaf);
    expect(leaf).toBeGreaterThan(0);
    expect(environmentResponse('Bark / umber', 'healthy_tree_a').translucency).toBeUndefined();
  });

  it('reads the names the models are actually authored with', () => {
    // These are lifted from the shipped GLBs. A rename in Blender that this
    // does not follow is a world where nothing moves and nothing glows.
    for (const name of ['Leaf / fern', 'Leaf / sunlit', 'Leaf / sage', 'Leaf / blue spruce', 'Flower / cream']) {
      expect(environmentResponse(name, 'grass_clump_a').translucency, name).toBeGreaterThan(0);
    }
  });
});

describe('installing the air on a material', () => {
  it('goes on once, however many callers ask', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const air = new AtmosphereState();
    const material = new PBRMaterial('Leaf / fern', scene);

    breatheOn(material, air);
    breatheOn(material, air);
    breatheOn(material, air, { wind: 0.05 });

    const installed = material.pluginManager?._plugins ?? [];
    expect(installed.filter((plugin) => plugin.name === 'Atmosphere')).toHaveLength(1);
    expect(material.pluginManager?.getPlugin('Atmosphere')).toBeTruthy();
    scene.dispose();
    engine.dispose();
  });

  it('leaves a material it cannot shade alone rather than throwing', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const air = new AtmosphereState();
    // The motes, the ground contacts and every VFX piece are StandardMaterial,
    // and all of them are either additive or right under the camera.
    const material = new StandardMaterial('world-motes', scene);
    expect(() => breatheOn(material, air)).not.toThrow();
    expect(material.pluginManager?.getPlugin('Atmosphere') ?? null).toBeNull();
    scene.dispose();
    engine.dispose();
  });

  it('starts from the biome the world opens in', () => {
    const air = new AtmosphereState();
    expect(air.density).toBeGreaterThan(0);
    expect(air.ceiling).toBeLessThan(1);
    // Nothing may be taken entirely by the air, at any distance: a road that
    // dissolved completely is a road with no horizon on it.
    expect(air.ceiling).toBeGreaterThan(0.5);
    expect(air.sun.length()).toBeCloseTo(1, 5);
  });
});

describe('what the glow pass is allowed to look at', () => {
  it('takes the spell work, the arcane gear and the lit scenery', () => {
    expect(isLuminousMaterial('VFX / arcane')).toBe(true);
    expect(isLuminousMaterial('VFX / arcane title')).toBe(true);
    expect(isLuminousMaterial('Arcane / ember heart')).toBe(true);
    expect(isLuminousMaterial('Lantern / candle')).toBe(true);
    expect(isLuminousMaterial('Shrine / jade inlay')).toBe(true);
  });

  it('refuses the four hundred meshes that can only ever answer black', () => {
    for (const name of [
      'matte meadow floor', 'worn earth trail', 'Leaf / fern', 'Bark / umber',
      'Cast / lavender fold', 'Iron / cast bronze', 'ground contact shade', 'world-motes',
    ]) {
      expect(isLuminousMaterial(name), name).toBe(false);
    }
    expect(isLuminousMaterial(undefined)).toBe(false);
  });

  it('agrees with the colour selector, because it is the same rule', () => {
    // The pass used to include every mesh and ask a selector per submesh per
    // frame what colour it glowed; almost all of them said black. Two rules
    // that could drift would be a mesh in the pass that cannot contribute, or
    // worse, one contributing that was never meant to.
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const luminous = new StandardMaterial('VFX / fire', scene);
    luminous.emissiveColor = new Color3(1, 0.4, 0.1);
    expect(isLuminousMaterial(luminous.name)).toBe(true);
    scene.dispose();
    engine.dispose();
  });
});
