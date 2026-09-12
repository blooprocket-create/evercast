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
   * Perceptible, and unhurried, as numbers CI can hold us to.
   *
   * The interesting measure is not the full turn - it is the *symmetry*. These
   * rings have twelve spokes, so one looks identical again after a twelfth of a
   * turn however slowly it is going. The first build chose rates that took
   * forty-two seconds to cross that, and on a phone the sigil read as a still
   * image. Under ten seconds is what makes it read as alive.
   */
  it('turns fast enough to be seen and slow enough not to spin', async () => {
    const scene = freshScene();
    const sigil = sigilIn(scene);
    await sigil.ready;

    const named = (id: string) => scene.meshes.find((mesh) => mesh.name === `Title ${id}`)!;
    for (let second = 0; second < 10; second += 1) sigil.update(1);

    const turned = SIGIL_LAYERS.map((layer) => named(layer.id).rotation.y);
    for (const layer of SIGIL_LAYERS) {
      const rate = Math.abs(layer.drift);
      // A twelfth of a turn in under twelve seconds: visible without staring.
      expect((2 * Math.PI) / 12 / rate).toBeLessThan(12);
      // A full turn no faster than forty seconds: drift, never a spin.
      expect((2 * Math.PI) / rate).toBeGreaterThan(40);
    }

    // Neighbours counter-turn, which is what stops it reading as one spinning
    // disc - and it means the relative motion a viewer sees is the sum of two
    // rates rather than one.
    expect(Math.sign(turned[0])).not.toBe(Math.sign(turned[1]));
    expect(Math.sign(turned[1])).not.toBe(Math.sign(turned[2]));
  });

  /**
   * What keeps the composition from settling, now that it is more than spin.
   *
   * An earlier version of this test claimed the rings never return to their
   * starting arrangement inside an hour, and at the old rates that was true to
   * within eleven degrees. At these rates the phases wrap far more often and
   * they come back within three, so the claim no longer holds and has been
   * dropped rather than loosened into meaninglessness.
   *
   * What is true, and is what the design actually rests on, is that no two
   * clocks in the sigil agree: three rotation periods in the golden ratio, and
   * three breath periods sharing no factor with them or with each other. A
   * rotational near-coincidence no longer produces the same picture, because the
   * rings will be at different points of their swell when it happens.
   */
  it('runs every layer on a clock that agrees with no other', () => {
    const rotation = SIGIL_LAYERS.map((layer) => (2 * Math.PI) / Math.abs(layer.drift));
    const breath = SIGIL_LAYERS.map((layer) => layer.breathSeconds);

    for (let i = 1; i < rotation.length; i += 1) {
      // Golden, so the rotations themselves are as far from a shared period as
      // two numbers can be.
      expect(Math.abs(rotation[i - 1] / rotation[i])).toBeCloseTo(1.618, 2);
    }

    const every = [...rotation, ...breath];
    expect(new Set(every.map((period) => period.toFixed(3))).size).toBe(every.length);
    for (let i = 0; i < every.length; i += 1) {
      for (let j = i + 1; j < every.length; j += 1) {
        // No period is a simple multiple of another, which is what a shared
        // factor would mean and what would let the picture recur.
        const ratio = every[i] / every[j];
        for (const simple of [0.5, 1, 1.5, 2, 2.5, 3]) {
          expect(Math.abs(ratio - simple)).toBeGreaterThan(0.04);
        }
      }
    }
  });

  /**
   * The swell is the half that survives symmetry.
   *
   * A ring that only spins changes phase, and a twelve-spoke ring hides a change
   * of phase. Rings that swell on different clocks change the gaps between them,
   * which is a change of shape - and that is what reads as alive on a form this
   * regular.
   */
  it('changes the spacing between rings, not just their phase', async () => {
    const scene = freshScene();
    const sigil = sigilIn(scene);
    await sigil.ready;

    const named = (id: string) => scene.meshes.find((mesh) => mesh.name === `Title ${id}`)!;
    const gapNow = () =>
      named(SIGIL_LAYERS[0].id).scaling.x - named(SIGIL_LAYERS[2].id).scaling.x;

    sigil.update(0);
    const gaps = [gapNow()];
    for (let sample = 0; sample < 12; sample += 1) {
      for (let frame = 0; frame < 60; frame += 1) sigil.update(1 / 60);
      gaps.push(gapNow());
    }

    const spread = Math.max(...gaps) - Math.min(...gaps);
    // In world units, against an outer ring built at 7.6 - a visible change in
    // the composition, not a rounding wobble.
    expect(spread).toBeGreaterThan(0.15);
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
