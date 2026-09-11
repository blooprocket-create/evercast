import { Scene, ShadowGenerator, TransformNode, Vector3 } from '@babylonjs/core';
// prettier-ignore
import type { CompanionClass, CompanionModelKey, CompanionRarity } from '../../engine/companions/types';
import { buildCompanion, type CompanionBuild } from './CompanionModels';

export type CompanionState = 'idle' | 'attack' | 'hit' | 'down';

/** How long each one-shot reaction runs before idle resumes. */
const DURATIONS: Readonly<Record<CompanionState, number>> = {
  idle: 0,
  attack: 0.42,
  hit: 0.26,
  down: 0.6,
};

/**
 * A companion on the field.
 *
 * Mirrors `ActorVisual`'s surface - root, play, update, dispose - so the scene
 * drives both the same way, but the art is primitives and the motion is code
 * rather than authored clips. When companions get real GLBs this class is what
 * gets replaced, and nothing calling it has to change.
 *
 * Everything advances on the presentation clock the scene passes in, which
 * hit-stop can slow or freeze. Nothing here can change what is true.
 */
export class CompanionVisual {
  readonly root: TransformNode;
  private readonly build: CompanionBuild;
  private readonly restLimbs: { node: TransformNode; position: Vector3; rotation: Vector3 }[];
  private state: CompanionState = 'idle';
  private clock = 0;
  private phase = 0;
  private downed = false;

  constructor(
    scene: Scene,
    name: string,
    modelKey: CompanionModelKey,
    companionClass: CompanionClass,
    rarity: CompanionRarity,
    stars: number,
    /** Offsets the idle cycle so a row of five does not breathe in unison. */
    seed = 0,
    shadows?: ShadowGenerator,
  ) {
    this.build = buildCompanion(scene, name, modelKey, companionClass, rarity, stars);
    this.root = this.build.root;
    this.phase = seed;
    this.restLimbs = this.build.limbs.map((node) => ({
      node,
      position: node.position.clone(),
      rotation: node.rotation.clone(),
    }));
    if (shadows) {
      for (const mesh of this.build.meshes) {
        shadows.addShadowCaster(mesh, false);
        mesh.onDisposeObservable.addOnce(() => shadows.removeShadowCaster(mesh, false));
      }
    }
  }

  /** Where this companion's effects should originate. */
  get muzzle(): Vector3 {
    return this.root.position.add(this.build.muzzle);
  }

  play(state: 'attack' | 'hit'): void {
    if (this.downed) return;
    // A flinch must not interrupt a swing that is already landing.
    if (state === 'hit' && this.state === 'attack') return;
    this.state = state;
    this.clock = 0;
  }

  setDowned(downed: boolean): void {
    if (downed === this.downed) return;
    this.downed = downed;
    this.state = downed ? 'down' : 'idle';
    this.clock = 0;
    if (!downed) this.restore();
  }

  update(delta: number): void {
    this.clock += Math.max(0, delta);
    this.phase += Math.max(0, delta);

    if (this.downed) {
      // Fold over and stay there. `progress` eases it rather than snapping, so
      // a knockout reads as falling rather than as a model popping sideways.
      const progress = Math.min(1, this.clock / DURATIONS.down);
      const eased = progress * progress * (3 - 2 * progress);
      this.root.rotation.z = eased * 1.35;
      this.root.position.y = 0.025 - eased * 0.12;
      return;
    }

    this.root.rotation.z = 0;
    const bob = this.build.hovers
      ? 0.09 * Math.sin(this.phase * 1.9)
      : 0.018 * Math.sin(this.phase * 2.4);
    this.root.position.y = 0.025 + bob + (this.build.hovers ? 0.22 : 0);

    const duration = DURATIONS[this.state];
    if (this.state !== 'idle' && this.clock >= duration) {
      this.state = 'idle';
      this.clock = 0;
      this.restore();
    }

    this.animateLimbs();
  }

  private animateLimbs(): void {
    const swing =
      this.state === 'attack'
        ? Math.sin(Math.min(1, this.clock / DURATIONS.attack) * Math.PI)
        : 0;
    const flinch =
      this.state === 'hit' ? Math.sin(Math.min(1, this.clock / DURATIONS.hit) * Math.PI) : 0;

    this.restLimbs.forEach((rest, index) => {
      const sway = 0.06 * Math.sin(this.phase * 2.2 + index);
      rest.node.rotation.z = rest.rotation.z + sway - swing * 0.9 + flinch * 0.35;
      rest.node.position.x = rest.position.x + swing * 0.22 - flinch * 0.12;
    });
  }

  private restore(): void {
    for (const rest of this.restLimbs) {
      rest.node.position.copyFrom(rest.position);
      rest.node.rotation.copyFrom(rest.rotation);
    }
  }

  dispose(): void {
    for (const mesh of this.build.meshes) mesh.dispose();
    for (const material of this.build.materials) material.dispose();
    this.root.dispose();
    this.restLimbs.length = 0;
  }
}
