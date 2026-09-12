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
}

/**
 * Three rings, and the rates are the whole design.
 *
 * They are in ratio 1 : phi : phi squared, so no two ever return to a shared
 * phase and the composition is never twice the same for the length of a
 * session. The outer rim travels about 3.7 px/s on a 1080-tall frame: findable
 * if you fix on one spoke, invisible as motion. That is the number "barely
 * there" means here, and `TitleSigil.test.ts` holds it to it.
 */
export const SIGIL_LAYERS: readonly SigilLayer[] = [
  { id: 'arcane_ring_a', scaling: 7.6, drift: 0.0125 },
  { id: 'arcane_glyph_a', scaling: 7.0, drift: -0.0202 },
  { id: 'arcane_ring_b', scaling: 5.4, drift: 0.0327 },
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

/** Non-commensurate with each other and with every drift rate above. */
const BREATH_SECONDS = 19.3;
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

interface Turning {
  node: TransformNode;
  drift: number;
}

export class TitleSigil {
  readonly root: TransformNode;
  readonly ready: Promise<void>;
  private readonly material: StandardMaterial;
  private readonly turning: Turning[] = [];
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
    const layers = [...SIGIL_LAYERS, { ...HEART, drift: 0 }];
    await Promise.all(
      layers.map(async (layer) => {
        const mesh = await this.instantiate(load, layer.id, layer.scaling);
        if (!mesh) return;
        if (layer.id === HEART.id) this.heart = mesh;
        if (layer.drift !== 0) this.turning.push({ node: mesh, drift: layer.drift });
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

    for (const { node, drift } of this.turning) node.rotation.y = this.clock * drift;

    const breath = this.drift ? 1 + 0.012 * Math.sin((2 * Math.PI * this.clock) / BREATH_SECONDS) : 1;
    this.root.scaling.setAll(breath * (0.94 + 0.06 * ignition));

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
    this.heart = null;
    this.material.dispose();
    this.root.dispose();
  }
}
