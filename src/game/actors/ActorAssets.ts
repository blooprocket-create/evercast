import { AbstractMesh, AnimationGroup, AssetContainer, LoadAssetContainerAsync, MeshBuilder, PBRMaterial, Color3, Scene, ShadowGenerator, TransformNode, Vector3, Quaternion } from '@babylonjs/core';
import { CROSS_FADE, crossFadeWeight, impulseAmount } from './PoseBlend';
import '@babylonjs/core/Rendering/outlineRenderer';
import '@babylonjs/loaders/glTF/2.0/glTFLoader';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_specular';
import type { GearSnapshot } from '../../engine/types';
import { burnAway, type AtmosphereState } from '../render/Atmosphere';
import { stylizeActorMaterial } from '../render/StylizedMaterials';
import manifest from '../../../public/models/characters/manifest.json';

export type ActorState = 'idle' | 'walk' | 'attack' | 'hit' | 'death';
export type ActorLoader = (url: string, scene: Scene) => Promise<AssetContainer>;
const models = new Set(manifest.assets.filter((a) => a.animations.length > 0).map((a) => a.id));

/** Cached source geometry; each combatant owns its animation targets and playback state. */
export class ActorAssets {
  private readonly requests = new Map<string, Promise<AssetContainer | undefined>>();
  private readonly containers = new Set<AssetContainer>();
  private disposed = false;

  constructor(private readonly scene: Scene, private readonly shadows?: ShadowGenerator,
    private readonly loader: ActorLoader = (url, scene) => LoadAssetContainerAsync(url, scene),
    private readonly atmosphere?: AtmosphereState) {}

  /**
   * Starts every animated model downloading without building a visual for it.
   *
   * Enemies are created by `sync`, which only runs once the game loop does, so
   * without this the boot gate could only ever wait for the mage: the first
   * foe's GLB was not even requested until after the gate had gone, and travel
   * is 1.8 seconds to cover it. Nine models and about 1.1 MB buys every enemy in
   * every zone, which is cheaper than the zone lookup that would narrow it and
   * cannot go stale when a zone's roster changes.
   */
  prewarm(): void {
    for (const id of models) this.request(id);
  }

  create(id: string, name: string, mage = false): ActorVisual {
    if (!models.has(id)) throw new Error(`Unknown actor model: ${id}`);
    const actor = new ActorVisual(name, this.scene);
    actor.root.metadata = { actorId: id, assetState: 'loading', animation: 'idle' };
    const request = this.request(id);
    void request.then((container) => {
      if (this.disposed || actor.root.isDisposed() || this.scene.isDisposed) return;
      if (!container) { actor.fallback(mage); return; }
      // Clones share geometry/materials, but permit independent hit overlays.
      const instance = container.instantiateModelsToScene((name) => name, false, { doNotInstantiate: true });
      for (const root of instance.rootNodes) root.parent = actor.root;
      for (const mesh of actor.root.getChildMeshes()) {
        mesh.isPickable = false;
        if (mesh.getTotalVertices() > 0 && this.shadows) {
          this.shadows.addShadowCaster(mesh, false);
          mesh.onDisposeObservable.addOnce(() => this.shadows?.removeShadowCaster(mesh, false));
        }
      }
      actor.attach(instance.animationGroups, () => instance.dispose());
      actor.root.metadata.assetState = 'ready';
    });
    return actor;
  }

  /** One download per model, however many combatants end up sharing it. */
  private request(id: string): Promise<AssetContainer | undefined> {
    let request = this.requests.get(id);
    if (!request) {
      request = this.loader(`${import.meta.env.BASE_URL}models/characters/${id}.glb`, this.scene).then((container) => {
        if (this.disposed || this.scene.isDisposed) { container.dispose(); return undefined; }
        for (const mesh of container.meshes) { mesh.isPickable = false; mesh.receiveShadows = true; }
        for (const material of container.materials) {
          if (material instanceof PBRMaterial) stylizeActorMaterial(material, this.atmosphere);
        }
        this.containers.add(container);
        return container;
      }).catch((error: unknown) => {
        if (!this.disposed) console.warn(`Evercast: could not load character ${id}.`, error);
        return undefined;
      });
      this.requests.set(id, request);
    }
    return request;
  }

  async whenReady(): Promise<void> { await Promise.all(this.requests.values()); }

  dispose(): void {
    this.disposed = true;
    for (const container of this.containers) container.dispose();
    this.containers.clear(); this.requests.clear();
  }
}

type RestPose = { node: TransformNode; position: Vector3; scaling: Vector3; rotation: Vector3; quaternion: Quaternion | null };

/**
 * One channel a clip writes to, and what it held when the last transition began.
 *
 * Collected from the clips themselves rather than from the node tree, which is
 * what makes the cross-fade correct by construction: whatever an animation
 * targets is exactly what gets blended, whether that is a joint's rotation or
 * a prop's scale, and a model that animates something nobody thought of is
 * covered without anyone having to think of it.
 */
type PoseTrack = {
  target: Record<string, unknown>;
  property: string;
  captured: Vector3 | Quaternion;
};

/** Presentation clock never changes combat timing or game state. */
export class ActorVisual {
  readonly root: TransformNode;
  private groups = new Map<string, AnimationGroup>();
  private rest: RestPose[] = [];
  private release?: () => void;
  private locomotion: ActorState = 'idle';
  private state: ActorState = 'idle';
  private clock = 0;
  private gear: readonly GearSnapshot[] = [];
  private dying = false;
  private playbackDuration?: number;
  private flashTime = 0;
  private flashMeshes: AbstractMesh[] = [];
  private sockets = new Map<string, TransformNode>();
  /** 0 is not there at all, 1 is solid. See `materialise`. */
  private veil = 1;
  private veilRate = 0;
  /** 0 is whole, 1 is gone. See `dissolve`. */
  private burn = 0;
  private burnRate = 0;
  /** Every channel the clips write, for the cross-fade. See `PoseTrack`. */
  private tracks: PoseTrack[] = [];
  private fadeLeft = 0;
  private fadeFor = 0;
  /**
   * The node the whole body hangs from, owned by this class alone.
   *
   * Inserted between `root` and the glTF conversion root so recoil has
   * somewhere to go. It cannot be written onto either of those: `root`'s
   * position is overwritten by the scene every frame from the simulation, and
   * the conversion root carries the importer's handedness fix.
   */
  private hinge?: TransformNode;
  private impulseLeft = 0;
  private impulseFor = 0;
  private readonly impulse = new Vector3();

  constructor(name: string, scene: Scene) { this.root = new TransformNode(name, scene); }

  attach(groups: AnimationGroup[], release: () => void): void {
    this.release = release;
    this.hinge = new TransformNode(`${this.root.name}-hinge`, this.root.getScene());
    this.hinge.parent = this.root;
    for (const child of [...this.root.getChildren()]) {
      if (child !== this.hinge) child.parent = this.hinge;
    }
    this.flashMeshes = this.root.getChildMeshes().filter(m => m.getTotalVertices()>0);
    // The meshes arrive after the veil was asked for: a foe that spawned while
    // its GLB was still downloading would otherwise snap in at full opacity.
    this.applyVeil();
    this.sockets = new Map(this.root.getDescendants().filter((n): n is TransformNode => n instanceof TransformNode && n.name.startsWith('socket_')).map(n=>[n.name,n]));
    this.groups = new Map(groups.map((g) => [g.name, g]));
    for (const group of groups) group.stop();
    this.rest = this.root.getDescendants(false).filter((n): n is TransformNode => n instanceof TransformNode).map((node) => ({
      node, position: node.position.clone(), scaling: node.scaling.clone(), rotation: node.rotation.clone(), quaternion: node.rotationQuaternion?.clone() ?? null,
    }));
    this.tracks = collectTracks(groups);
    this.setGear(this.gear);
    this.start(this.state, this.playbackDuration, true);
  }

  /**
   * Throws the body, in world space, away from whatever hit it.
   *
   * Layered over the clip rather than replacing it, which is the whole point:
   * `play('hit')` refuses to interrupt a swing, so in a busy fight most hits
   * used to land on an actor that showed nothing at all. This one always reads,
   * because it moves the node the clips do not touch.
   */
  shove(direction: Vector3, strength: number, seconds = 0.26): void {
    if (!this.hinge || this.dying || strength <= 0) return;
    // Into the body's own frame. The actors only ever turn about y, so this is
    // exact and costs two trig calls rather than a matrix inverse.
    const yaw = this.root.rotation.y;
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const x = direction.x * cos - direction.z * sin;
    const z = direction.x * sin + direction.z * cos;
    const length = Math.hypot(x, z) || 1;
    // A second blow while the first is still settling replaces it rather than
    // summing: two hits in a frame must not launch anything across the road.
    this.impulse.set((x / length) * strength, 0, (z / length) * strength);
    this.impulseFor = Math.max(0.01, seconds);
    this.impulseLeft = this.impulseFor;
  }

  setLocomotion(walking: boolean): void {
    this.locomotion = walking ? 'walk' : 'idle';
    if ((this.state === 'idle' || this.state === 'walk') && this.state !== this.locomotion) this.start(this.locomotion);
  }

  play(state: 'attack' | 'hit' | 'death', duration?: number): void {
    if (this.dying || (state === 'hit' && this.state === 'attack')) return;
    if (state === 'death') this.dying = true;
    this.start(state, duration);
  }

  /**
   * Abandons a swing the simulation has cancelled.
   *
   * Needed because the attack clip is started from the *windup* and stretched
   * across it, so a broken Surge leaves a boss most of two seconds of gather
   * still to play - and it would follow through on a blow that is no longer
   * coming. Cross-fades back to locomotion out of whatever pose is on screen,
   * rather than snapping, which is what `start`'s soft path already does.
   */
  interrupt(): void {
    if (this.dying || this.state !== 'attack') return;
    this.start(this.locomotion);
  }

  revive(walking: boolean): void {
    this.dying = false; this.locomotion = walking ? 'walk' : 'idle'; this.start(this.locomotion, undefined, true);
    this.burn = 0; this.burnRate = 0; this.veil = 1; this.veilRate = 0;
    this.applyVeil();
  }

  /**
   * Fades up out of nothing over `seconds` instead of appearing.
   *
   * The composition asks for this rather than taste: the shot is aimed further
   * down the road than it used to be, so on a wide screen the spawn line is
   * just inside the frame and a boss's is well inside it. An enemy that simply
   * appeared there would be a pop in open grass. Walking out of the haze is
   * both the fix and the better arrival - and it costs one number per actor,
   * because `visibility` is a per-mesh value on a shared material.
   */
  materialise(seconds: number): void {
    this.veil = 0;
    this.veilRate = 1 / Math.max(0.01, seconds);
    this.applyVeil();
  }

  /**
   * How much of this actor is on screen, 0 to 1.
   *
   * Read by anything drawn *over* the actor rather than by it - a health bar
   * hanging at full opacity above a foe that has not arrived yet is the veil
   * defeating itself, and at the reframed aim the spawn line is in shot.
   */
  get solidity(): number {
    return this.veil * (1 - this.burn);
  }

  /**
   * The other end, and not the same idea at all: a body coming apart.
   *
   * The arrival is a veil because a foe walking out of the haze should look
   * like weather. A death should not - a corpse that simply grew transparent
   * was the one moment in a fight where the game admitted the bodies were
   * meshes being switched off. This hands the job to the shader instead, which
   * eats the surface along a noise front and lights the edge it leaves, and it
   * costs one number per body because the amount is bound per mesh rather than
   * per material. See `burnAway`.
   *
   * The flat fade is still underneath it, well back: it is what a surface the
   * plugin never reached - the matte fallback capsule, most of all - still
   * does, and it is what takes the last of the body off the screen.
   */
  dissolve(seconds: number): void {
    this.burnRate = 1 / Math.max(0.01, seconds);
  }

  update(delta: number): void {
    if (this.veilRate !== 0) {
      this.veil = Math.min(1, Math.max(0, this.veil + this.veilRate * delta));
      if (this.veil >= 1 || this.veil <= 0) this.veilRate = 0;
      this.applyVeil();
    }
    if (this.burnRate !== 0) {
      this.burn = Math.min(1, this.burn + this.burnRate * delta);
      if (this.burn >= 1) this.burnRate = 0;
      this.applyVeil();
    }
    this.flashTime = Math.max(0,this.flashTime-delta);
    for (const mesh of this.flashMeshes) {
      mesh.renderOverlay=this.flashTime>0;
      mesh.overlayAlpha=this.flashTime*2.2;
    }
    this.clock += Math.max(0, delta);
    const group = this.groups.get(this.state);
    const fps = group?.targetedAnimations[0]?.animation.framePerSecond ?? 60;
    const clipDuration = group ? (group.to - group.from) / fps : (this.state === 'death' ? 1.1 : 0.5);
    const duration = this.playbackDuration ?? clipDuration;
    const loop = this.state === 'idle' || this.state === 'walk';
    if (group && duration > 0) group.goToFrame(group.from + (loop ? this.clock % duration : Math.min(this.clock, duration)) / duration * clipDuration * fps);
    /*
     * The cross-fade runs after the clip has been sampled, never before: the
     * clip writes the pose, and this pulls that pose back toward the one the
     * actor was holding when the state changed. Doing it the other way round
     * would have `goToFrame` overwrite the blend the instant it was applied.
     *
     * On the presentation delta rather than the real one, like everything else
     * here, so hit-stop freezes a transition mid-blend along with the picture.
     */
    if (this.fadeLeft > 0) {
      this.fadeLeft -= delta;
      this.applyCrossFade(crossFadeWeight(this.fadeLeft, this.fadeFor));
    }
    this.applyImpulse(delta);
    if (!loop && this.clock >= duration && !this.dying) this.start(this.locomotion);
  }

  setGear(gear: readonly GearSnapshot[]): void {
    this.gear = gear;
    const tiers = new Map(gear.map((piece) => [piece.slot as string, piece.evolutionTier]));
    for (const node of this.root.getDescendants()) {
      const match = /^upgrade_(.+)_(\d+)(?:_R)?$/.exec(node.name);
      if (match) node.setEnabled(Number(match[2]) <= (tiers.get(match[1]) ?? 0));
    }
  }

  socketPosition(name: string, fallback: Vector3): Vector3 {
    const socket = this.sockets.get(name);
    if (socket instanceof TransformNode) { socket.computeWorldMatrix(true); return socket.getAbsolutePosition().clone(); }
    return this.root.position.add(fallback);
  }

  fallback(mage: boolean): void {
    const mesh = MeshBuilder.CreateCylinder(`${this.root.name}-fallback`, { height: 1, diameterTop: 0.35, diameterBottom: 0.65, tessellation: 8 }, this.root.getScene());
    mesh.parent = this.root; mesh.position.y = 0.5;
    const material = new PBRMaterial(`${this.root.name}-fallback-matte`, this.root.getScene());
    material.albedoColor = mage ? new Color3(0.25, 0.18, 0.35) : new Color3(0.25, 0.34, 0.17);
    material.metallic = 0; material.roughness = 1; material.specularIntensity = 0; mesh.material = material;
    this.release = () => { mesh.dispose(); material.dispose(); };
    this.root.metadata.assetState = 'fallback';
  }

  flash(critical = false): void {
    this.flashTime = critical ? .095 : .065;
    for (const mesh of this.flashMeshes) mesh.overlayColor.set(critical ? 1 : .65,.7,1);
  }

  dispose(): void { this.sockets.clear();this.flashMeshes=[]; this.release?.(); this.root.dispose(); this.groups.clear(); this.rest = []; }

  private applyVeil(): void {
    /*
     * Cubed, so the fade sits behind the dissolve rather than beside it: the
     * body holds better than nine tenths of its alpha through the first half
     * of a burn, where the shader is doing the work, and only gives it up at
     * the end. It also has to be strictly under one for any burn at all, or
     * Babylon dispatches the mesh to the opaque pass and throws the alpha the
     * shader just computed away.
     */
    const fade = this.veil * (1 - this.burn * this.burn * this.burn);
    for (const mesh of this.flashMeshes) {
      mesh.visibility = fade;
      burnAway(mesh, this.burn);
    }
  }

  /**
   * `hard` snaps to the bind pose instead of blending out of whatever was
   * showing. Two callers want that and nothing else does: the first frame after
   * the meshes arrive, which has no previous pose to blend from, and `revive`,
   * which is a reset rather than a transition - an actor coming back must land
   * on its bind pose rather than approach it, or a body that died mid-blend
   * could get up still slightly folded.
   */
  private start(state: ActorState, duration?: number, hard = false): void {
    for (const group of this.groups.values()) group.stop();
    if (hard) {
      for (const pose of this.rest) {
        pose.node.position.copyFrom(pose.position); pose.node.scaling.copyFrom(pose.scaling); pose.node.rotation.copyFrom(pose.rotation);
        if (pose.quaternion) pose.node.rotationQuaternion = pose.quaternion.clone();
      }
      this.fadeLeft = 0;
      this.impulseLeft = 0;
      this.hinge?.position.setAll(0);
      this.hinge?.rotation.setAll(0);
    } else {
      // Whatever is on screen right now becomes the thing the new clip grows
      // out of. Captured before `goToFrame` overwrites it, which is the only
      // moment the outgoing pose still exists anywhere.
      this.capturePose();
      this.fadeFor = CROSS_FADE[state];
      this.fadeLeft = this.fadeFor;
    }
    this.state = state; this.clock = 0;
    this.playbackDuration = duration;
    this.root.metadata.animation = state;
    const group = this.groups.get(state);
    if (group) { group.start(true); group.pause(); group.goToFrame(group.from); }
    if (!hard) this.applyCrossFade(crossFadeWeight(this.fadeLeft, this.fadeFor));
  }

  private capturePose(): void {
    for (const track of this.tracks) {
      const value = track.target[track.property];
      if (value instanceof Vector3 && track.captured instanceof Vector3) track.captured.copyFrom(value);
      else if (value instanceof Quaternion && track.captured instanceof Quaternion) track.captured.copyFrom(value);
    }
  }

  /** `weight` is how much of the captured pose is still showing. */
  private applyCrossFade(weight: number): void {
    if (weight <= 0) return;
    for (const track of this.tracks) {
      const value = track.target[track.property];
      if (value instanceof Vector3 && track.captured instanceof Vector3) {
        Vector3.LerpToRef(value, track.captured, weight, value);
      } else if (value instanceof Quaternion && track.captured instanceof Quaternion) {
        Quaternion.SlerpToRef(value, track.captured, weight, value);
      }
    }
  }

  private applyImpulse(delta: number): void {
    if (!this.hinge || this.impulseLeft <= 0) return;
    this.impulseLeft -= delta;
    const elapsed = 1 - Math.max(0, this.impulseLeft) / this.impulseFor;
    const amount = impulseAmount(elapsed);
    this.hinge.position.set(this.impulse.x * amount, 0, this.impulse.z * amount);
    // The body leans into the blow as well as sliding under it, which is what
    // keeps a shove from reading as the whole model being nudged sideways.
    this.hinge.rotation.set(this.impulse.z * amount * 1.6, 0, -this.impulse.x * amount * 1.6);
    if (this.impulseLeft <= 0) {
      this.impulseLeft = 0;
      this.hinge.position.setAll(0);
      this.hinge.rotation.setAll(0);
    }
  }
}

/**
 * Every distinct channel the clips write to, deduplicated.
 *
 * A model's clips overwhelmingly target the same joints as one another, so the
 * union is barely larger than any one clip - and it has to be the union, or a
 * joint that only the death clip moves would be left mid-fade forever.
 */
function collectTracks(groups: readonly AnimationGroup[]): PoseTrack[] {
  const tracks: PoseTrack[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const targeted of group.targetedAnimations) {
      const property = targeted.animation.targetProperty;
      const target = targeted.target as Record<string, unknown> & { uniqueId?: number };
      if (!target || typeof property !== 'string') continue;
      const key = `${target.uniqueId ?? String(target)}:${property}`;
      if (seen.has(key)) continue;
      const value = target[property];
      // Position, rotation and scale are the whole of what a glTF clip writes.
      // Anything else - a morph weight, a colour - is left to the clip alone
      // rather than blended wrongly.
      if (value instanceof Vector3) tracks.push({ target, property, captured: value.clone() });
      else if (value instanceof Quaternion) tracks.push({ target, property, captured: value.clone() });
      else continue;
      seen.add(key);
    }
  }
  return tracks;
}
