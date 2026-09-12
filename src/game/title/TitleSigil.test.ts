import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  AbstractMesh,
  TransformNode,
  AssetContainer,
  Constants,
  LoadAssetContainerAsync,
  NullEngine,
  Scene,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core';
import { SIGIL_LAYERS, SIGIL_MOTES, TitleSigil, type TitleSigilLoader } from './TitleSigil';

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

const meshIn = (scene: Scene, id: string) =>
  scene.meshes.find((mesh) => mesh.name === `Title ${id}`)!;

/**
 * Which way a mesh is long, taken from the geometry rather than written down.
 *
 * The shards are slivers, and which axis they are slivers along is a fact about
 * the art - so the test that cares reads it off the vertices instead of
 * repeating a number that the next export could quietly change.
 */
/**
 * Where a mesh is actually pointing, in world space.
 *
 * Not `rotation.y`, and the difference is the whole reason this helper exists.
 * The glTF loader hands every imported node a `rotationQuaternion`, Babylon
 * ignores `rotation` outright while one is set, and `clone()` copies it - so
 * the first sigil to ship set Euler angles that no world matrix ever read and
 * never turned at all. Three tests asserted the property and passed.
 *
 * Everything about turning is therefore asserted through the transform, which
 * is the thing a renderer would use.
 */
function headingOf(mesh: AbstractMesh, root: TransformNode): Vector3 {
  // The root carries the sigil's own quarter turn, so it has to be current
  // before anything composed against it means anything.
  root.computeWorldMatrix(true);
  mesh.computeWorldMatrix(true);
  return Vector3.TransformNormal(new Vector3(1, 0, 0), mesh.getWorldMatrix()).normalize();
}

/** The angle between two headings, which is how far the mesh swept. */
const sweptBetween = (from: Vector3, to: Vector3) =>
  Math.acos(Math.min(1, Math.max(-1, Vector3.Dot(from, to))));

function longestAxisOf(mesh: AbstractMesh): Vector3 {
  const extent = mesh.getBoundingInfo().boundingBox.extendSize;
  if (extent.x >= extent.y && extent.x >= extent.z) return new Vector3(1, 0, 0);
  return extent.y >= extent.z ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1);
}

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

    const before = SIGIL_LAYERS.map((layer) => headingOf(meshIn(scene, layer.id), sigil.root));
    // Ten seconds in frame-sized steps, because `update` clamps a delta to a
    // quarter second - ten calls of `update(1)` is two and a half seconds of
    // sigil, which is how an earlier version of this test came to compare a
    // rate against a quarter of its own elapsed time and not notice.
    for (let frame = 0; frame < 600; frame += 1) sigil.update(1 / 60);
    const after = SIGIL_LAYERS.map((layer) => headingOf(meshIn(scene, layer.id), sigil.root));

    for (const [index, layer] of SIGIL_LAYERS.entries()) {
      const rate = Math.abs(layer.drift);
      // A twelfth of a turn in under twelve seconds: visible without staring.
      expect((2 * Math.PI) / 12 / rate).toBeLessThan(12);
      // A full turn no faster than forty seconds: drift, never a spin.
      expect((2 * Math.PI) / rate).toBeGreaterThan(40);
      // And the mesh is what moved, not a field nothing composes.
      expect(sweptBetween(before[index], after[index]), `${layer.id} never turned`).toBeCloseTo(
        rate * 10,
        6,
      );
    }

    // Neighbours counter-turn, which is what stops it reading as one spinning
    // disc - and it means the relative motion a viewer sees is the sum of two
    // rates rather than one. Read as the direction the transform swept: the
    // rings turn about their own local Y, which the root stands up onto world Z.
    const sense = SIGIL_LAYERS.map((_, index) =>
      Math.sign(Vector3.Cross(before[index], after[index]).z),
    );
    expect(sense[0]).not.toBe(sense[1]);
    expect(sense[1]).not.toBe(sense[2]);
  });

  /**
   * What keeps the composition from settling, measured as the thing it is.
   *
   * Two earlier versions of this test compared each pair of periods against a
   * list of simple fractions someone had remembered to write down, and both
   * times a coincidence walked straight through the gaps in that list: first a
   * five-to-two, then - after retuning to escape it - a seven-to-three, where
   * three turns of the inner ring and seven breaths of the outer both land on
   * 130.9 seconds. A third list would have had a third gap.
   *
   * So this computes the quantity the design actually cares about: for every
   * pair of clocks, the soonest moment they come back into step. No fractions,
   * no list, nothing to forget.
   */
  it('keeps every pair of clocks from lining up again for twelve minutes', () => {
    const periods = [
      ...SIGIL_LAYERS.map((layer) => (2 * Math.PI) / Math.abs(layer.drift)),
      ...SIGIL_LAYERS.map((layer) => layer.breathSeconds),
    ];

    /** Half a second apart is indistinguishable; that is what "in step" means. */
    const TOLERANCE = 0.5;
    const CYCLES = 60;

    const resyncOf = (a: number, b: number) => {
      let soonest = Number.POSITIVE_INFINITY;
      for (let p = 1; p <= CYCLES; p += 1) {
        for (let q = 1; q <= CYCLES; q += 1) {
          if (Math.abs(p * a - q * b) < TOLERANCE) soonest = Math.min(soonest, p * a);
        }
      }
      return soonest;
    };

    let soonest = Number.POSITIVE_INFINITY;
    let culprit = '';
    for (let i = 0; i < periods.length; i += 1) {
      for (let j = i + 1; j < periods.length; j += 1) {
        const when = resyncOf(periods[i], periods[j]);
        if (when < soonest) {
          soonest = when;
          culprit = `${periods[i].toFixed(2)}s and ${periods[j].toFixed(2)}s`;
        }
      }
    }

    // Measured at 731s for the current set. Far past any title screen's welcome.
    expect(soonest, `${culprit} come back into step after ${soonest.toFixed(0)}s`).toBeGreaterThan(
      600,
    );
  });

  it('still runs the three rotations in the golden ratio', () => {
    const rotation = SIGIL_LAYERS.map((layer) => (2 * Math.PI) / Math.abs(layer.drift));
    for (let i = 1; i < rotation.length; i += 1) {
      expect(rotation[i - 1] / rotation[i]).toBeCloseTo(1.618, 2);
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

    const before = SIGIL_LAYERS.map((layer) => headingOf(meshIn(scene, layer.id), sigil.root));
    for (let second = 0; second < 10; second += 1) sigil.update(1);

    for (const [index, layer] of SIGIL_LAYERS.entries()) {
      const mesh = meshIn(scene, layer.id);
      expect(sweptBetween(before[index], headingOf(mesh, sigil.root))).toBeCloseTo(0, 9);
      expect(mesh.visibility).toBe(1);
    }
  });

  /**
   * The shards are the only part of this that can show a rotation, so which way
   * they point is not a detail.
   *
   * They import as slivers along their own local Y, and the root's quarter turn
   * about X aims local Y straight down the camera's axis - so a shard left
   * alone renders end-on, as a dot, and setting `rotation.y` on it spins it
   * about its own length where there is nothing to see. That shipped, under a
   * comment claiming the opposite.
   *
   * Asserted as the thing it is rather than as the fix: a shard's long axis has
   * to lie along the direction it is actually travelling. Measured by moving it
   * and comparing, so it stays true whichever axis a future export is long on.
   */
  it('flies its shards along their travel rather than end-on to the camera', async () => {
    const scene = freshScene();
    const sigil = sigilIn(scene);
    await sigil.ready;

    // Past the ignition first. It scales the root, and a root that is still
    // growing adds a radial component to every shard's travel.
    for (let frame = 0; frame < 200; frame += 1) sigil.update(1 / 60);

    const posed = (id: string) => {
      const mesh = meshIn(scene, id);
      // The root carries the sigil's whole transform, so it has to be current
      // before a child composed against it means anything.
      sigil.root.computeWorldMatrix(true);
      mesh.computeWorldMatrix(true);
      return mesh;
    };

    const before = SIGIL_MOTES.map((mote) => posed(mote.id).getAbsolutePosition().clone());
    // Short enough that the chord of the arc is the tangent to well inside the
    // tolerance below, long enough to be far above float noise.
    sigil.update(0.2);

    for (const [index, mote] of SIGIL_MOTES.entries()) {
      const mesh = posed(mote.id);
      const travel = mesh.getAbsolutePosition().subtract(before[index]);
      expect(travel.length(), `${mote.id} never moved`).toBeGreaterThan(1e-3);

      const along = Vector3.TransformNormal(longestAxisOf(mesh), mesh.getWorldMatrix()).normalize();
      // Either end of the sliver leads; only the axis is the claim.
      const alignment = Math.abs(Vector3.Dot(along, travel.normalize()));
      expect(alignment, `${mote.id} is broadside to its own orbit`).toBeGreaterThan(0.99);
    }
  });

  /**
   * Which ring a shard rides has to survive the network.
   *
   * `turning` is filled from inside a `Promise.all`, so its order is whichever
   * download finished first - and the first version of this looked the ring up
   * by position in that array. On a cold cache the shards rode the rings they
   * name; on a warm one they rode whichever landed first, and the pairing was
   * different from load to load.
   *
   * The releases below make the completion order the exact reverse of the
   * declared order, which is the condition under which a positional lookup is
   * wrong about all three.
   */
  it('rides the ring it names, whatever order the downloads land in', async () => {
    const scene = freshScene();
    const rings = SIGIL_LAYERS.map((layer) => layer.id);
    const gates = new Map<string, () => void>();
    const held = new Map<string, Promise<void>>();
    for (const id of rings) {
      let open!: () => void;
      held.set(
        id,
        new Promise<void>((resolve) => {
          open = resolve;
        }),
      );
      gates.set(id, open);
    }

    const landed: string[] = [];
    const staggered: TitleSigilLoader = async (url, target) => {
      const id = url.slice(url.lastIndexOf('/') + 1).replace('.glb', '');
      // Undefined for the heart and the shards, and awaiting that resolves at
      // once - only the rings are held.
      await held.get(id);
      const container = await local(url, target);
      landed.push(id);
      return container;
    };

    const sigil = new TitleSigil(scene, { drift: true, loader: staggered });
    for (const id of [...rings].reverse()) {
      gates.get(id)!();
      // Drained rather than raced: one ring has to be all the way through the
      // loader before the next is let go, or the order is not actually decided.
      for (let tick = 0; tick < 4; tick += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    await sigil.ready;

    // Without this the test is vacuous - it only says anything while the
    // completion order really does disagree with the declared one.
    expect(landed.filter((id) => rings.includes(id))).toEqual([...rings].reverse());

    for (let frame = 0; frame < 200; frame += 1) sigil.update(1 / 60);

    for (const mote of SIGIL_MOTES) {
      const shard = meshIn(scene, mote.id);
      const ring = meshIn(scene, mote.rides);
      const want = ring.rotation.y + mote.phase;
      const got = Math.atan2(shard.position.z, shard.position.x);
      // Wrapped into (-pi, pi], because these are angles and 0 is 2pi.
      const gap = Math.atan2(Math.sin(got - want), Math.cos(got - want));
      expect(Math.abs(gap), `${mote.id} is not riding ${mote.rides}`).toBeLessThan(1e-6);
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
