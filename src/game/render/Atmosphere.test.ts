import { describe, expect, it } from 'vitest';
import {
  Color3,
  MeshBuilder,
  MultiMaterial,
  NullEngine,
  PBRMaterial,
  Scene,
  StandardMaterial,
  type MaterialDefines,
  type UniformBuffer,
} from '@babylonjs/core';
import { AtmospherePlugin, AtmosphereState, breatheOn, burnAway } from './Atmosphere';
import { environmentResponse } from '../world/EnvironmentMaterials';
import { isLuminousMaterial, isLuminousSurface } from './LuminousGlow';

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

describe('a body coming apart', () => {
  it('compiles the burn only into the surfaces that can burn', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const air = new AtmosphereState();
    const body = new PBRMaterial('Cast / lavender fold', scene);
    const bark = new PBRMaterial('Bark / umber', scene);
    breatheOn(body, air, { burn: true });
    breatheOn(bark, air, { wind: 0.02 });
    const mesh = MeshBuilder.CreateBox('probe', {}, scene);

    const defines = (material: PBRMaterial) => {
      const flags = {} as MaterialDefines;
      material.pluginManager!.getPlugin<AtmospherePlugin>('Atmosphere')!.prepareDefines(flags, scene, mesh);
      return flags;
    };
    expect(defines(body).ATMO_BURN).toBe(true);
    expect(defines(bark).ATMO_BURN).toBe(false);
    // A tree still sways; the flags are independent.
    expect(defines(bark).ATMO_WIND).toBe(true);
    scene.dispose();
    engine.dispose();
  });

  it('holds the amount per mesh, because the bodies share a material', () => {
    // Four briarlings on the road are one material between them. A burn set on
    // that material would take all four the moment any one of them died, so
    // the amount rides the draw instead - which is what `hardBindForSubMesh`
    // is for, and why it is not `bindForSubMesh`: that one is skipped entirely
    // for the second body, the material having already been bound for the first.
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const air = new AtmosphereState();
    const shared = new PBRMaterial('Cast / lavender fold', scene);
    breatheOn(shared, air, { burn: true });
    const plugin = shared.pluginManager!.getPlugin<AtmospherePlugin>('Atmosphere')!;
    const dying = MeshBuilder.CreateBox('dying', {}, scene);
    const standing = MeshBuilder.CreateBox('standing', {}, scene);
    dying.material = standing.material = shared;
    burnAway(dying, 0.4);

    const written: number[][] = [];
    const ubo = {
      updateFloat4: (name: string, x: number, y: number, z: number, w: number) => {
        if (name === 'vAtmoBurn') written.push([x, y, z, w]);
      },
    } as unknown as UniformBuffer;
    plugin.hardBindForSubMesh(ubo, scene, engine, dying.subMeshes[0]);
    plugin.hardBindForSubMesh(ubo, scene, engine, standing.subMeshes[0]);
    expect(written.map((v) => v[0])).toEqual([0.4, 0]);
    // The ember rides along, and it is over one on purpose: the image
    // processing is a post-process, so this is unclamped light and the bloom
    // threshold is what decides whether an edge glows.
    expect(written[0][1]).toBeGreaterThan(1);

    // Clamped, so a caller that overshoots cannot push the cut past its own
    // range and leave a body that never finishes going.
    burnAway(dying, 4);
    plugin.hardBindForSubMesh(ubo, scene, engine, dying.subMeshes[0]);
    expect(written[2][0]).toBe(1);

    burnAway(dying, 0);
    plugin.hardBindForSubMesh(ubo, scene, engine, dying.subMeshes[0]);
    expect(written[3][0]).toBe(0);
    scene.dispose();
    engine.dispose();
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

  it('finds a luminous material inside one that carries several', () => {
    // Nothing shipped hits this - Babylon's glTF loader splits a
    // multi-primitive mesh into one mesh per primitive, each with its own
    // single material, which is why the shrine's inlay matches by name at all.
    // A MultiMaterial would fail silently and asset-shaped, so it is covered.
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const stone = new StandardMaterial('Stone / warm slate', scene);
    const inlay = new StandardMaterial('Shrine / jade inlay', scene);
    const combined = new MultiMaterial('forest_shrine_arch', scene);
    combined.subMaterials = [stone, inlay];

    expect(isLuminousMaterial(combined.name)).toBe(false);
    expect(isLuminousSurface(combined)).toBe(true);
    expect(isLuminousSurface(new MultiMaterial('all stone', scene))).toBe(false);
    expect(isLuminousSurface(null)).toBe(false);
    scene.dispose();
    engine.dispose();
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
