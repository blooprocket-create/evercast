import { AbstractMesh, AnimationGroup, AssetContainer, LoadAssetContainerAsync, MeshBuilder, PBRMaterial, Color3, Scene, ShadowGenerator, TransformNode, Vector3, Quaternion } from '@babylonjs/core';
import '@babylonjs/core/Rendering/outlineRenderer';
import '@babylonjs/loaders/glTF/2.0/glTFLoader';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_specular';
import type { GearSnapshot } from '../../engine/types';
import type { AtmosphereState } from '../render/Atmosphere';
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

  constructor(name: string, scene: Scene) { this.root = new TransformNode(name, scene); }

  attach(groups: AnimationGroup[], release: () => void): void {
    this.release = release;
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
    this.setGear(this.gear);
    this.start(this.state, this.playbackDuration);
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

  revive(walking: boolean): void {
    this.dying = false; this.locomotion = walking ? 'walk' : 'idle'; this.start(this.locomotion);
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
    return this.veil;
  }

  /** The other end of the same idea: a body settling out of the picture. */
  dissolve(seconds: number): void {
    this.veilRate = -1 / Math.max(0.01, seconds);
  }

  update(delta: number): void {
    if (this.veilRate !== 0) {
      this.veil = Math.min(1, Math.max(0, this.veil + this.veilRate * delta));
      if (this.veil >= 1 || this.veil <= 0) this.veilRate = 0;
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
    for (const mesh of this.flashMeshes) mesh.visibility = this.veil;
  }

  private start(state: ActorState, duration?: number): void {
    for (const group of this.groups.values()) group.stop();
    for (const pose of this.rest) {
      pose.node.position.copyFrom(pose.position); pose.node.scaling.copyFrom(pose.scaling); pose.node.rotation.copyFrom(pose.rotation);
      if (pose.quaternion) pose.node.rotationQuaternion = pose.quaternion.clone();
    }
    this.state = state; this.clock = 0;
    this.playbackDuration = duration;
    this.root.metadata.animation = state;
    const group = this.groups.get(state);
    if (group) { group.start(true); group.pause(); group.goToFrame(group.from); }
  }
}
