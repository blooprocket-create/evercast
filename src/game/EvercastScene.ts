import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  DefaultRenderingPipeline,
  Engine,
  GlowLayer,
  HemisphericLight,
  ImageProcessingConfiguration,
  PBRMaterial,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core';
import type { GameEvent } from '../engine/events/GameEvent';
import type { SimulationSnapshot } from '../engine/types';
import {
  earnedJourneyStages,
  initialJourneyTravelSeconds,
  WORLD_TRAVEL_SECONDS_PER_STAGE,
} from './world/JourneyProgress';
import { WorldGenerator } from './world/WorldGenerator';
import { ActorAssets, ActorVisual } from './actors/ActorAssets';
import { VfxPool, type VfxQuality } from './vfx/VfxPool';
import { CombatFxPresenter } from './vfx/CombatFxPresenter';
import { SpellVfxPresenter } from './vfx/SpellVfxPresenter';
import { castDuration } from './vfx/CombatVfxPlan';

export class EvercastScene {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly mage: ActorVisual;
  private readonly actors: ActorAssets;
  private readonly world: WorldGenerator;
  private readonly shadows: ShadowGenerator;
  private readonly enemyMeshes = new Map<number, ActorVisual>();
  private readonly retiring: { id: number; actor: ActorVisual; remaining: number }[] = [];
  readonly vfx: SpellVfxPresenter;
  private readonly transientAnchors = new Map<number, { position: Vector3; remaining: number }>();
  private gearSignature = '';
  private mageRecovery = 0;
  private journeyInitialized = false;
  private visualFrontierStage = 1;
  private pendingWorldTravelSeconds = 0;

  constructor(canvas: HTMLCanvasElement, quality: VfxQuality = 'medium') {
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.025, 0.035, 0.06, 1);

    const camera = new ArcRotateCamera(
      'camera',
      -Math.PI / 2,
      1.31,
      17.5,
      new Vector3(0.9, 1.15, 1),
      this.scene,
    );
    camera.lowerRadiusLimit = 17.5;
    camera.upperRadiusLimit = 17.5;
    camera.fov = 0.68;
    camera.minZ = 0.2;
    camera.maxZ = 180;
    camera.inputs.clear();

    const presentation = new DefaultRenderingPipeline('environment finish', true, this.scene, [camera]);
    presentation.samples = 4;
    presentation.fxaaEnabled = true;
    presentation.bloomEnabled = false;
    this.scene.imageProcessingConfiguration.toneMappingEnabled = true;
    this.scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    this.scene.imageProcessingConfiguration.exposure = 1.2;
    this.scene.imageProcessingConfiguration.contrast = 1.04;
    this.scene.imageProcessingConfiguration.vignetteEnabled = true;
    this.scene.imageProcessingConfiguration.vignetteWeight = 1.25;
    this.scene.imageProcessingConfiguration.vignetteColor = new Color4(0.04, 0.055, 0.045, 0);

    const skyLight = new HemisphericLight('sky', new Vector3(0, 1, 0), this.scene);
    skyLight.intensity = 0.65;
    const sun = new DirectionalLight('sun', new Vector3(0.5, -1, 0.45), this.scene);
    sun.position = new Vector3(-10, 20, -9);
    sun.intensity = 1.5;
    sun.shadowMinZ = 1;
    sun.shadowMaxZ = 65;
    sun.shadowFrustumSize = 38;
    this.shadows = new ShadowGenerator(2048, sun);
    this.shadows.usePercentageCloserFiltering = true;
    this.shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    this.shadows.bias = 0.0005;
    this.shadows.normalBias = 0.04;
    this.shadows.setDarkness(0.22);

    const glow = new GlowLayer('glow', this.scene, { blurKernelSize: 24 });
    glow.intensity = 0.32;
    glow.customEmissiveColorSelector = (_mesh, _subMesh, material, result) => {
      const luminous =
        material && /VFX \/|Arcane \/|Lantern \/ candle|Shrine \/ jade inlay/.test(material.name);
      const color =
        luminous && (material instanceof PBRMaterial || material instanceof StandardMaterial)
          ? material.emissiveColor
          : Color3.Black();
      result.set(color.r, color.g, color.b, 1);
    };
    this.world = new WorldGenerator(this.scene, skyLight, sun, this.shadows);
    this.actors = new ActorAssets(this.scene, this.shadows);
    this.mage = this.actors.create('mage', 'mage-character', true);
    this.mage.root.position.set(-3.2, 0.025, 0);
    this.mage.root.rotation.y = Math.PI * 0.68;
    const pool = new VfxPool(this.scene, quality);
    this.vfx = new SpellVfxPresenter(pool, new CombatFxPresenter(pool, this.scene, camera), {
      staff: () => this.mage.socketPosition('socket_spell', new Vector3(0.55, 1.65, 0)),
      mage: () => this.mage.root.position.add(new Vector3(0, 1, 0)),
      target: (id) =>
        this.enemyActor(id)?.root.position.add(new Vector3(0, 0.65, 0)) ??
        this.transientAnchors.get(id)?.position,
      actor: (id) => this.enemyActor(id),
    });

    this.resize();
    this.engine.runRenderLoop(() => this.scene.render());
    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.keydown);
  }

  sync(snapshot: SimulationSnapshot, deltaSeconds: number, events: readonly GameEvent[]): void {
    const walking = snapshot.phase === 'travel';
    this.syncJourney(snapshot, deltaSeconds, walking);
    const gearSignature = snapshot.gear.map((g) => `${g.slot}:${g.evolutionTier}`).join('|');
    if (gearSignature !== this.gearSignature) {
      this.mage.setGear(snapshot.gear);
      this.gearSignature = gearSignature;
    }
    this.mage.setLocomotion(walking);
    this.mage.update(deltaSeconds);
    for (let i = this.retiring.length - 1; i >= 0; i--) {
      const entry = this.retiring[i];
      entry.remaining -= deltaSeconds;
      entry.actor.update(deltaSeconds);
      if (entry.remaining <= 0) {
        entry.actor.dispose();
        this.retiring.splice(i, 1);
      }
    }
    for (const enemy of this.enemyMeshes.values()) enemy.update(deltaSeconds);
    for (const [id, entry] of this.transientAnchors) {
      entry.remaining -= deltaSeconds;
      if (entry.remaining <= 0) this.transientAnchors.delete(id);
    }
    // A target may spawn and die within the same simulation advance. Retain its
    // presentation anchor without inventing a substitute living target.
    for (const event of events)
      if (event.type === 'enemy_spawned') {
        const index = (event.spawned - 1) % 6;
        if (this.transientAnchors.size >= 96)
          this.transientAnchors.delete(this.transientAnchors.keys().next().value!);
        const position = event.position
          ? new Vector3(event.position.x, 0.025, event.position.z)
          : formationPosition(index);
        this.transientAnchors.set(event.instanceId, {
          position: position.addInPlace(new Vector3(0, 0.65, 0)),
          remaining: 1,
        });
      }

    for (const event of events) {
      if (event.type === 'enemy_killed') {
        const mesh = this.enemyMeshes.get(event.instanceId);
        if (mesh) {
          this.retiring.push({ id: event.instanceId, actor: mesh, remaining: 1.8 });
          if (this.retiring.length > 24) this.retiring.shift()!.actor.dispose();
          this.enemyMeshes.delete(event.instanceId);
        }
      }
    }

    this.syncEnemyVisuals(snapshot, deltaSeconds);
    for (const event of events) {
      if (event.type === 'spell_cast') this.mage.play('attack', castDuration(snapshot.castInterval));
      if (event.type === 'enemy_attack') {
        this.enemyMeshes.get(event.instanceId)?.play('attack');
        this.mage.play('hit');
      }
      if (event.type === 'mage_defeated') {
        this.mage.play('death');
        this.mageRecovery = 1.2;
      }
      if (event.type === 'gear_evolved')
        this.vfx.combat.burst(this.mage.root.position.add(new Vector3(0, 1, 0)), 'arcane');
    }
    this.vfx.update(deltaSeconds);
    this.vfx.ingest(snapshot, events);
    if (this.mageRecovery > 0) {
      this.mageRecovery -= deltaSeconds;
      if (this.mageRecovery <= 0) this.mage.revive(walking);
    }
  }

  async whenReady(): Promise<void> {
    await Promise.all([this.actors.whenReady(), this.vfx.pool.ready]);
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.keydown);
    this.vfx.dispose();
    this.transientAnchors.clear();
    for (const mesh of this.enemyMeshes.values()) mesh.dispose();
    this.enemyMeshes.clear();
    for (const entry of this.retiring) entry.actor.dispose();
    this.retiring.length = 0;
    this.mage.dispose();
    this.actors.dispose();
    this.world.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }

  private readonly resize = (): void => {
    this.engine.resize();
    const aspect = this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight());
    // Keep both combat formations in frame on portrait screens.
    if (this.scene.activeCamera)
      this.scene.activeCamera.fov = Math.max(0.68, 2 * Math.atan(11 / (35 * aspect)));
  };

  private readonly keydown = (event: KeyboardEvent): void => {
    if (import.meta.env.DEV && event.key.toLowerCase() === 'n' && !event.repeat)
      this.world.jumpToNextBiome(event.shiftKey);
  };

  private syncJourney(snapshot: SimulationSnapshot, deltaSeconds: number, walking: boolean): void {
    if (!this.journeyInitialized) {
      this.visualFrontierStage = Math.max(1, snapshot.stage);
      const initialTravel = initialJourneyTravelSeconds(this.visualFrontierStage);
      if (initialTravel > 0) this.world.update(initialTravel, true);
      this.journeyInitialized = true;
    }

    const newlyEarnedStages = earnedJourneyStages({
      mode: snapshot.mode,
      frontierStage: snapshot.stage,
      visualFrontierStage: this.visualFrontierStage,
    });

    if (newlyEarnedStages > 0) {
      this.pendingWorldTravelSeconds += newlyEarnedStages * WORLD_TRAVEL_SECONDS_PER_STAGE;
      this.visualFrontierStage = snapshot.stage;
    }

    if (snapshot.mode === 'push' && walking && this.pendingWorldTravelSeconds > 0) {
      const travelStep = Math.min(deltaSeconds, this.pendingWorldTravelSeconds);
      this.world.update(travelStep, true);
      this.pendingWorldTravelSeconds -= travelStep;
      return;
    }

    this.world.update(deltaSeconds, false);
  }

  private syncEnemyVisuals(snapshot: SimulationSnapshot, deltaSeconds: number): void {
    const livingIds = new Set(snapshot.enemies.map((enemy) => enemy.instanceId));
    for (const [id, actor] of this.enemyMeshes) {
      if (!livingIds.has(id)) {
        actor.dispose();
        this.enemyMeshes.delete(id);
      }
    }
    snapshot.enemies.forEach((enemy, index) => {
      const destination = enemy.position
        ? new Vector3(enemy.position.x, 0.025, enemy.position.z)
        : formationPosition(index);
      let actor = this.enemyMeshes.get(enemy.instanceId);
      if (!actor) {
        const id = enemy.modelKey.split('/').pop()!.replaceAll('-', '_');
        actor = this.actors.create(id, `enemy-${enemy.instanceId}`);
        actor.root.rotation.y = -Math.PI * 0.68;
        actor.root.scaling.setAll(enemy.boss ? 1.12 : 1);
        actor.root.position.copyFrom(destination).addInPlace(new Vector3(1.2, 0, 0));
        this.enemyMeshes.set(enemy.instanceId, actor);
      }
      Vector3.LerpToRef(
        actor.root.position,
        destination,
        1 - Math.exp(-deltaSeconds * 7),
        actor.root.position,
      );
      actor.setLocomotion(Vector3.DistanceSquared(actor.root.position, destination) > 0.004);
    });
  }
  private enemyActor(id: number): ActorVisual | undefined {
    return this.enemyMeshes.get(id) ?? this.retiring.find((entry) => entry.id === id)?.actor;
  }
}

function formationPosition(index: number): Vector3 {
  const column = index % 3,
    row = Math.floor(index / 3);
  // Stagger the rear rank so six simultaneous hit/chain endpoints stay visible.
  return new Vector3(2.4 + column * 1.2 + row * 0.48, 0.025, (row - 0.5) * 1.25);
}
