import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  AssetContainer,
  Constants,
  LoadAssetContainerAsync,
  NullEngine,
  Scene,
  StandardMaterial,
} from '@babylonjs/core';
import { SIGIL_LAYERS, TitleSigil } from './TitleSigil';

/**
 * The real GLBs off disk through a `NullEngine`, which is how every other
 * Babylon module here is tested - see `vfx/VfxLifecycle.test.ts` and
 * `actors/ActorAssets.test.ts`. No GPU, no mocks of our own geometry.
 */
function local(url: string, scene: Scene): Promise<AssetContainer> {
  return LoadAssetContainerAsync(
    new Uint8Array(readFileSync(resolve('public', url.replace(/^\//, '')))),
    scene,
    { pluginExtension: '.glb' },
  );
}

const sigilIn = (scene: Scene, drift = true) => new TitleSigil(scene, { drift, loader: local });

const freshScene = () => new Scene(new NullEngine());

describe('title sigil', () => {
  it('builds every layer from the real arcane meshes', async () => {
    const scene = freshScene();
    const sigil = sigilIn(scene);
    await sigil.ready;

    for (const layer of SIGIL_LAYERS) {
      const mesh = scene.meshes.find((candidate) => candidate.name === `Title ${layer.id}`);
      expect(mesh, `${layer.id} is missing`).toBeDefined();
      expect(mesh!.getTotalVertices()).toBeGreaterThan(0);
    }
  });

  /**
   * The void rule, as an assertion rather than a comment.
   *
   * Fog sits at Babylon's default until the first `sync()` - a 95% grey wash at
   * the distance the title is framed from - so a sigil material that ever
   * forgot this would be washed out on the first screen of the game.
   */
  it('opts every material it owns out of fog, and keeps them additive', async () => {
    const scene = freshScene();
    const sigil = sigilIn(scene);
    await sigil.ready;

    const sigilMaterial = scene.materials.find(
      (material): material is StandardMaterial =>
        material instanceof StandardMaterial && material.name === 'VFX / arcane title',
    )!;
    expect(sigilMaterial).toBeDefined();
    expect(sigilMaterial.fogEnabled).toBe(false);
    expect(sigilMaterial.alphaMode).toBe(Constants.ALPHA_ADD);
    // The glow layer selects on this prefix; renaming it silently drops the bloom.
    expect(sigilMaterial.name.startsWith('VFX /')).toBe(true);
  });

  /**
   * "Barely there" and "never resolves", as numbers CI can hold us to.
   */
  it('drifts slowly, in alternating directions, without ever repeating', async () => {
    const scene = freshScene();
    const sigil = sigilIn(scene);
    await sigil.ready;

    const named = (id: string) => scene.meshes.find((mesh) => mesh.name === `Title ${id}`)!;
    for (let second = 0; second < 10; second += 1) sigil.update(1);

    const turned = SIGIL_LAYERS.map((layer) => named(layer.id).rotation.y);
    // Ten seconds in, nothing has moved more than a third of a radian.
    for (const rotation of turned) expect(Math.abs(rotation) / 10).toBeLessThan(0.035);
    // Neighbours counter-turn, which is what stops it reading as one spinning disc.
    expect(Math.sign(turned[0])).not.toBe(Math.sign(turned[1]));
    expect(Math.sign(turned[1])).not.toBe(Math.sign(turned[2]));
  });

  /**
   * "Never resolves", tested the way a player would notice it rather than by
   * arithmetic about ratios.
   *
   * The rates are in the golden ratio, and the useful consequence is not that
   * the numbers are irrational - it is that the three rings never come back to
   * the arrangement they started in. So simulate an hour, far longer than any
   * title screen is looked at, and assert the composition never returns.
   *
   * Worth noting why the obvious test is wrong: demanding each pairwise ratio
   * sit far from every simple p/q fails for phi, because Fibonacci fractions
   * like 3/5 are its *best* rational approximations. Phi is the hardest number
   * to approximate relative to denominator size, not in absolute terms.
   */
  it('never returns the rings to the arrangement they started in', () => {
    const rates = SIGIL_LAYERS.map((layer) => layer.drift);
    const fromStart = (radians: number) => {
      const wrapped = Math.abs(radians) % (2 * Math.PI);
      return Math.min(wrapped, 2 * Math.PI - wrapped);
    };

    const closestWithin = (seconds: number) => {
      let closest = Number.POSITIVE_INFINITY;
      // Skip the first few seconds, where the rings have not yet left the
      // arrangement they are being measured against.
      for (let t = 10; t <= seconds; t += 0.25) {
        closest = Math.min(closest, Math.max(...rates.map((rate) => fromStart(rate * t))));
      }
      return closest;
    };

    // Measured: half an hour never brings it within 18.7 degrees of the start,
    // and a full hour never within 11.1. The thresholds sit just under those, so
    // this fails if the rates are retuned into something that does loop.
    expect(closestWithin(1800)).toBeGreaterThan(0.3);
    expect(closestWithin(3600)).toBeGreaterThan(0.15);
  });

  /**
   * The ignition has to start from dark, and that is a claim about the moment
   * the meshes land rather than about the curve.
   *
   * `EvercastScene` attaches the drift observer only after `ready`, because the
   * observer owns this clock: start it at construction and the two and a half
   * seconds of fade-up are spent while the sigil is still invisible and
   * loading, so a slow enough download burns the ignition completely and the
   * sigil snaps on fully lit. This is the half of that contract which can be
   * tested without a GPU.
   */
  it('is built dark, and lights only once something drives it', async () => {
    const scene = freshScene();
    const sigil = sigilIn(scene);
    await sigil.ready;

    for (const layer of SIGIL_LAYERS) {
      const mesh = scene.meshes.find((candidate) => candidate.name === `Title ${layer.id}`)!;
      expect(mesh.visibility).toBe(0);
    }

    // A full ignition's worth of clock, in frame-sized steps.
    for (let frame = 0; frame < 150; frame += 1) sigil.update(1 / 60);
    for (const layer of SIGIL_LAYERS) {
      const mesh = scene.meshes.find((candidate) => candidate.name === `Title ${layer.id}`)!;
      expect(mesh.visibility).toBeCloseTo(1, 3);
    }
  });

  /**
   * The house doctrine, quoted from `SummonReveal.module.css`: "Someone who has
   * asked for less motion still gets the result." The result is the sigil.
   */
  it('stands still for reduced motion, but is fully present', async () => {
    const scene = freshScene();
    const sigil = sigilIn(scene, false);
    await sigil.ready;

    for (let second = 0; second < 10; second += 1) sigil.update(1);

    for (const layer of SIGIL_LAYERS) {
      const mesh = scene.meshes.find((candidate) => candidate.name === `Title ${layer.id}`)!;
      // Negative drift times a zero clock is -0, which is still no rotation.
      expect(Math.abs(mesh.rotation.y)).toBe(0);
      expect(mesh.visibility).toBe(1);
    }
  });

  it('stands a primitive in for a mesh that never arrived', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scene = freshScene();
    const sigil = new TitleSigil(scene, {
      drift: true,
      loader: () => Promise.reject(new Error('offline')),
    });

    await expect(sigil.ready).resolves.toBeUndefined();
    // A sigil missing a ring would read as a bug on the first screen of the
    // game, so the shape degrades rather than the composition.
    for (const layer of SIGIL_LAYERS) {
      expect(scene.meshes.some((mesh) => mesh.name === `Title ${layer.id}`)).toBe(true);
    }
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('gives back every mesh and material it took', async () => {
    const scene = freshScene();
    const meshesBefore = scene.meshes.length;

    const sigil = sigilIn(scene);
    await sigil.ready;
    expect(scene.meshes.length).toBeGreaterThan(meshesBefore);

    sigil.dispose();
    expect(scene.meshes.length).toBe(meshesBefore);
    // Babylon creates `default material` lazily during the build and owns it,
    // so the claim is about what the sigil made, not about the scene's total -
    // the same distinction `vfx/VfxLifecycle.test.ts` draws.
    const mine = scene.materials.filter((material) => material.name === 'VFX / arcane title');
    expect(mine).toEqual([]);
  });

  it('does not raise a mesh that finished loading after it was disposed', async () => {
    const scene = freshScene();
    let release: (() => void) | null = null;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const sigil = new TitleSigil(scene, {
      drift: true,
      loader: async (url, target) => {
        await held;
        return local(url, target);
      },
    });

    const meshesBefore = scene.meshes.length;
    sigil.dispose();
    release!();
    await sigil.ready;

    // Pressing Begin mid-download must not leave geometry behind in the world.
    expect(scene.meshes.length).toBeLessThanOrEqual(meshesBefore);
  });
});
