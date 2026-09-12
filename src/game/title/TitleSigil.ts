import {
  AssetContainer,
  Color3,
  LoadAssetContainerAsync,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF/2.0/glTFLoader';
import { SCHOOL_COLORS, additive } from '../vfx/VfxPool';

export type TitleSigilLoader = (url: string, scene: Scene) => Promise<AssetContainer>;

/**
 * The arcane sigil behind the title, built from the game's own VFX meshes.
 *
 * It loads the GLBs directly rather than borrowing `VfxPool`. The pool is built
 * for transient combat effects - fixed slots, a life in seconds, a per-frame
 * `update` - and, decisively, its `dispose()` frees the shared `Geometry` it
 * hands out. A sigil holding those meshes would be a teardown-order trap for
 * the sake of five files that the browser cache almost certainly serves twice
 * for free, since the pool requests the same URLs in the same tick.
 *
 * What it does take from the pool is the arcane colour and the additive recipe,
 * because two definitions of "the spell's violet" would drift the moment either
 * was tuned.
 */

/**
 * A lift small enough to keep the hue, and the ceiling is what decides it.
 *
 * Arcane is (0.61, 0.44, 1.0). Multiply that hard enough to cross the bloom
 * threshold on its own and the blue channel clamps at 1 while red catches up,
 * which does not make the sigil brighter so much as it makes it *grey*: the
 * first build ran at 1.7 and put a pale lilac wheel on screen instead of a
 * violet one. The ratio between the channels is the colour, and clipping
 * flattens it.
 *
 * It does not need to reach the threshold anyway. The glow layer selects this
 * material by name and does the blooming, so the gain is free to sit *below*
 * one and let the halo carry the light while the geometry keeps its colour.
 * ACES compresses hard near the top of the range, so the way to a richer violet
 * is down, not up.
 */
const EMISSIVE_GAIN = 0.75;

/**
 * Named `VFX /` on purpose: the glow layer's selector matches that prefix
 * (`EvercastScene`), so the sigil is picked up by the same bloom pass the spell
 * effects use without the scene knowing it exists.
 */
const MATERIAL_NAME = 'VFX / arcane title';

export interface SigilLayer {
  /** Mesh id in `public/models/vfx`. */
  readonly id: string;
  readonly scaling: number;
  /** Radians per second. Signs alternate so neighbouring rings counter-turn. */
  readonly drift: number;
  /** How far this ring swells and shrinks, as a fraction of its own size. */
  readonly breadth: number;
  /** Seconds for one swell. Non-commensurate with every other period here. */
  readonly breathSeconds: number;
}

/**
 * Three rings, and the rates are the whole design.
 *
 * They are in ratio 1 : phi : phi squared, so no two ever return to a shared
 * phase and the composition is never twice the same for the length of a session.
 *
 * The first build ran these four times slower, on the theory that a title screen
 * should be barely-there. On a phone it read as a still image, and the reason is
 * worth writing down: a twelve-spoke ring is *rotationally symmetric every
 * thirty degrees*, so it looks identical again after 0.52 radians however
 * carefully the rate was chosen. Rotating a symmetric form is close to the least
 * perceptible motion available. At these rates the outer rim turns through that
 * symmetry in about ten seconds instead of forty, and neighbouring rings counter-
 * turn, so the relative motion a viewer actually sees is the sum of two rates,
 * not one.
 *
 * `breadth` is the other half of the answer. A ring that only spins changes
 * phase; rings that swell on different clocks change the *spacing between
 * them*, which is a change of shape, and shape survives symmetry.
 *
 * It survived it rather too well. At the first amplitudes the breath was the
 * only motion anyone reported seeing - the sigil read as pulsing, not turning,
 * because a scale change moves every pixel outward at once while a rotation
 * moves spokes into the places other spokes just left. So the breath is pulled
 * back here, and `SIGIL_MOTES` carries the job it was over-doing: a handful of
 * shards orbiting outside the rim, where a single point of light has no
 * symmetry to hide in and its travel is unmistakable.
 *
 * Six clocks run here, and the number that matters about them is not how far
 * apart they look - it is how long until two of them line up again, because
 * that is when the picture repeats. Picking them by eye does not work: one set
 * put three turns of the inner ring against seven breaths of the outer, both
 * landing on 130.9 seconds, and the set before that hid a five-to-two. These
 * are searched rather than chosen, and no two come back together inside twelve
 * minutes. `TitleSigil.test.ts` computes that directly.
 */
export const SIGIL_LAYERS: readonly SigilLayer[] = [
  { id: 'arcane_ring_a', scaling: 7.6, drift: 0.055, breadth: 0.017, breathSeconds: 17.0 },
  { id: 'arcane_glyph_a', scaling: 7.0, drift: -0.089, breadth: 0.025, breathSeconds: 23.7 },
  { id: 'arcane_ring_b', scaling: 5.4, drift: 0.144, breadth: 0.021, breathSeconds: 31.8 },
];

export interface SigilMote {
  readonly id: string;
  readonly scaling: number;
  /** How far out it orbits. The outer ring's rim sits at about 5.1. */
  readonly radius: number;
  /**
   * Which layer's angle it rides, by that layer's `id`.
   *
   * A name rather than an index into `SIGIL_LAYERS`, and the distinction has
   * already cost one bug: the rings are built from inside a `Promise.all`, so
   * the order they arrive in is the order their downloads happened to finish.
   * Anything positional silently pairs a shard with whichever ring landed
   * first, which on a warm cache is a different ring than on a cold one.
   */
  readonly rides: string;
  /** Where on that orbit it starts. Golden-angle stagger, as the VFX already use. */
  readonly phase: number;
}

/**
 * What makes the rotation legible.
 *
 * The rings cannot show their own turning: twelve spokes means twelve positions
 * that look alike, so a ring can sweep thirty degrees and arrive looking exactly
 * as it left. A single shard has no such symmetry - there is one of it, it is
 * somewhere, and a moment later it is somewhere else.
 *
 * They ride the rings' own angles rather than keeping clocks of their own. That
 * is not only tidier: every independent period is another pair that can fall
 * into step, and the six already here were hard enough to choose. These add
 * none.
 *
 * Placed outside the rim, in the clear, where there is nothing for the eye to
 * confuse them with - and the one on the fastest ring is furthest out, because
 * angular speed is only half of what the eye reads as movement.
 */
export const SIGIL_MOTES: readonly SigilMote[] = [
  { id: 'arcane_shard_a', scaling: 0.52, radius: 5.95, rides: 'arcane_ring_a', phase: 0 },
  { id: 'arcane_shard_b', scaling: 0.46, radius: 4.45, rides: 'arcane_glyph_a', phase: 2.399 },
  { id: 'arcane_shard_c', scaling: 0.5, radius: 6.4, rides: 'arcane_ring_b', phase: 4.798 },
];

/**
 * Still, but never quite still: the heart carries the pulse instead of a turn.
 *
 * Small, and deliberately so. The rings are sized to leave the middle of the
 * frame empty, because that is where the wordmark and the button go - a sigil
 * with geometry behind the type is a sigil competing with it. The heart is the
 * one thing allowed in there, sitting under the button as a glow rather than a
 * shape.
 */
const HEART = { id: 'arcane_core_a', scaling: 0.8 } as const;

/** Non-commensurate with each other and with every period above. */
const PULSE_SECONDS = 11.7;
const IGNITE_SECONDS = 2.4;

/** Matches `GameLoop`'s own clamp: a stalled tab must not jump the sigil. */
const MAX_FRAME_SECONDS = 0.25;

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

/**
 * Honours the player's motion preference, guarded for a server and for tests.
 *
 * Both guards are load-bearing: this module is unit-tested in Node with no DOM,
 * the same reason `SummonReveal` carries them.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

interface Orbiting {
  node: TransformNode;
  radius: number;
  /** The ring itself, resolved once at build time - never an index. */
  ring: Turning | null;
  phase: number;
}

interface Turning {
  id: string;
  node: TransformNode;
  drift: number;
  /** The scale it was built at; the breath is measured against this. */
  base: number;
  breadth: number;
  breathSeconds: number;
  /** Golden-angle stagger, so no two rings are ever at the same point of their swell. */
  phase: number;
}

export class TitleSigil {
  readonly root: TransformNode;
  readonly ready: Promise<void>;
  private readonly material: StandardMaterial;
  private readonly turning: Turning[] = [];
  private readonly orbiting: Orbiting[] = [];
  /** Everything that ignites. The void behind them does not. */
  private readonly owned: Mesh[] = [];
  private heart: Mesh | null = null;
  private readonly drift: boolean;
  private clock = 0;
  private disposed = false;

  constructor(
    private readonly scene: Scene,
    options: { drift?: boolean; loader?: TitleSigilLoader } = {},
  ) {
    this.drift = options.drift ?? !prefersReducedMotion();
    const load = options.loader ?? ((url, target) => LoadAssetContainerAsync(url, target));

    this.root = new TransformNode('Title sigil', scene);
    // Rings and glyphs import lying flat in XZ - `CombatFxPresenter` stands its
    // impact ring up with exactly this rotation, and that ring reads as facing
    // the camera. Leaving it a touch shy of upright rakes the sigil against the
    // camera's own 15 degrees of tilt, which is what gives it depth rather than
    // reading as a decal.
    this.root.rotation.x = Math.PI / 2;

    this.material = new StandardMaterial(MATERIAL_NAME, scene);
    this.material.disableLighting = true;
    this.material.backFaceCulling = false;
    // The void rule. Fog is at Babylon's default until the first `sync()`, which
    // is a 95% grey wash at this distance - it would swallow the sigil whole.
    // `WorldBackdrop` opts its ridges out the same way.
    this.material.fogEnabled = false;
    this.material.emissiveColor = Color3.FromHexString(SCHOOL_COLORS.arcane).scale(EMISSIVE_GAIN);
    additive(this.material);

    this.ready = this.build(load);
  }

  /**
   * There is no backdrop mesh, and there was one until it was looked at.
   *
   * The plan called for an owned plane rather than trusting the world's sky
   * quad to render black with its uniforms unset. It was built parented to the
   * root - which is rotated a quarter turn about X to stand the rings up, and
   * that maps local +Z to world -Y. The "backdrop" was therefore lying flat
   * three units *below* the sigil, facing the floor, and had never been in
   * frame at all.
   *
   * What was actually drawing the void the whole time is the scene's own clear
   * colour, with the sky quad over it: that shader's uniforms are never set
   * before the first `sync()`, and unset uniforms are zero by specification, so
   * it resolves to black rather than merely happening to. Two things already
   * doing the job is enough; a third that has to be oriented correctly to work
   * is a liability, not insurance.
   */

  private async build(load: TitleSigilLoader): Promise<void> {
    // The heart neither turns nor swells; it pulses, so it joins with zeros.
    const layers: readonly SigilLayer[] = [
      ...SIGIL_LAYERS,
      { ...HEART, drift: 0, breadth: 0, breathSeconds: 1 },
    ];
    await Promise.all(
      layers.map(async (layer, index) => {
        const mesh = await this.instantiate(load, layer.id, layer.scaling);
        if (!mesh) return;
        if (layer.id === HEART.id) this.heart = mesh;
        if (layer.drift !== 0) {
          this.turning.push({
            id: layer.id,
            node: mesh,
            drift: layer.drift,
            base: layer.scaling,
            breadth: layer.breadth,
            breathSeconds: layer.breathSeconds,
            phase: index * 2.399,
          });
        }
      }),
    );

    await Promise.all(
      SIGIL_MOTES.map(async (mote) => {
        const mesh = await this.instantiate(load, mote.id, mote.scaling);
        if (!mesh) return;
        // By identity. `turning` was filled from inside the `Promise.all`
        // above, so its order is download-completion order and reading slot
        // `n` from it would hand this shard an arbitrary ring.
        this.orbiting.push({
          node: mesh,
          radius: mote.radius,
          ring: this.turning.find((candidate) => candidate.id === mote.rides) ?? null,
          phase: mote.phase,
        });
        // Standing the shard up out of the ring plane's normal, once.
        //
        // These meshes are slivers along their own local Y - which the root's
        // quarter turn about X aims straight down the camera's axis, so left
        // alone they render as three dots, and `rotation.y` only spins each one
        // about its own length where nothing can see it. A quarter turn about X
        // here lays the long axis into the orbit plane instead, leaving the
        // broad face toward the camera and the heading to `update`.
        mesh.rotation.x = Math.PI / 2;
      }),
    );

    // Nothing is visible until the first update, so an ignition that never runs
    // cannot leave a half-lit sigil on screen.
    this.update(0);
  }

  /**
   * One mesh, or a primitive standing in for it.
   *
   * A sigil that silently lost a ring would read as a bug on the first screen
   * of the game, so a failed download is substituted rather than skipped: the
   * shape is poorer, the composition is intact.
   */
  private async instantiate(
    load: TitleSigilLoader,
    id: string,
    scaling: number,
  ): Promise<Mesh | null> {
    let mesh: Mesh | null = null;
    try {
      const container = await load(`${import.meta.env.BASE_URL}models/vfx/${id}.glb`, this.scene);
      if (this.disposed || this.scene.isDisposed) {
        container.dispose();
        return null;
      }
      const source = container.meshes.find(
        (candidate): candidate is Mesh => candidate instanceof Mesh && candidate.getTotalVertices() > 0,
      );
      if (source) {
        mesh = source.clone(`Title ${id}`, null, true);
        mesh.makeGeometryUnique();
        mesh.bakeTransformIntoVertices(source.computeWorldMatrix(true));
        mesh.parent = null;
      }
      container.dispose();
    } catch (error) {
      if (!this.disposed) console.warn(`Evercast: could not load title mesh ${id}.`, error);
    }

    if (this.disposed || this.scene.isDisposed) {
      mesh?.dispose();
      return null;
    }
    if (!mesh) mesh = MeshBuilder.CreateTorus(`Title ${id}`, { diameter: 1, thickness: 0.06 }, this.scene);

    /*
     * The line that makes this thing turn, and it was missing.
     *
     * The glTF loader gives every node it imports a `rotationQuaternion`, and
     * `clone()` carries it across. Babylon reads `rotation` only while that is
     * null - so `update()` was setting Euler angles that nothing composed into
     * a world matrix, and the sigil that shipped never rotated a degree. The
     * breath was the only motion on screen, which is exactly what it looked
     * like. Three tests asserted `rotation.y` and all three passed, because the
     * property they read was faithfully set and simply never used.
     *
     * `VfxPool` does this too, on the line after its own `bakeTransformInto-
     * Vertices`, and that is the point: this file deliberately does not borrow
     * the pool, and quietly inherited none of what the pool had learned. The
     * two lines above are copied from it; this is the one that was not.
     */
    mesh.rotationQuaternion = null;
    mesh.material = this.material;
    mesh.isPickable = false;
    mesh.scaling.setAll(scaling);
    mesh.parent = this.root;
    mesh.visibility = 0;
    this.owned.push(mesh);
    return mesh;
  }

  /**
   * Advances the drift. Driven by the scene's own render observer, because the
   * game loop does not run until the player presses Begin - and `update(delta)`
   * is what every other animated thing in this codebase already is.
   */
  update(deltaSeconds: number): void {
    if (this.disposed) return;
    if (this.drift) this.clock += Math.min(Math.max(deltaSeconds, 0), MAX_FRAME_SECONDS);

    // Once, on arrival. This is the readiness signal as much as it is an
    // effect: the sigil coming up is how the player learns the world has landed.
    const ignition = this.drift ? smoothstep(Math.min(1, this.clock / IGNITE_SECONDS)) : 1;

    for (const ring of this.turning) {
      ring.node.rotation.y = this.clock * ring.drift;
      // Each ring on its own clock, so the gaps between them open and close
      // rather than the whole wheel pumping as one.
      const swell = this.drift
        ? 1 + ring.breadth * Math.sin((2 * Math.PI * this.clock) / ring.breathSeconds + ring.phase)
        : 1;
      ring.node.scaling.setAll(ring.base * swell);
    }

    // Riding a ring's angle rather than a clock of their own - see SIGIL_MOTES.
    // The rings lie in the root's XZ plane, which the root's quarter turn about
    // X stands up to face the camera, so an orbit is drawn there too.
    for (const mote of this.orbiting) {
      const angle = (mote.ring ? mote.ring.node.rotation.y : 0) + mote.phase;
      mote.node.position.set(
        Math.cos(angle) * mote.radius,
        0,
        Math.sin(angle) * mote.radius,
      );
      // The heading, on top of the quarter turn `build` already applied. Babylon
      // composes Euler angles as Y then X then Z, so that quarter turn has
      // carried the shard's long axis to local +Z and this swings it round to
      // the orbit's tangent, which at `angle` is (-sin, 0, cos) - hence the
      // negative. A sliver pointing along its own travel reads as flying;
      // pointing across it, it reads as sliding sideways.
      mote.node.rotation.y = -angle;
    }

    this.root.scaling.setAll(0.94 + 0.06 * ignition);

    for (const mesh of this.owned) mesh.visibility = ignition;
    if (this.heart) {
      const pulse = this.drift
        ? 0.78 + 0.22 * Math.sin((2 * Math.PI * this.clock) / PULSE_SECONDS + 1.1)
        : 1;
      this.heart.visibility = ignition * pulse;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Meshes first, then the material they share. Disposing a material per mesh
    // would free the shared one on the first ring and leave the rest pointing
    // at it.
    for (const mesh of this.owned) mesh.dispose();
    this.owned.length = 0;
    this.turning.length = 0;
    this.orbiting.length = 0;
    this.heart = null;
    this.material.dispose();
    this.root.dispose();
  }
}
