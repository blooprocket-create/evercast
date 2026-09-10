import {
  ArcRotateCamera,
  Color3,
  Color4,
  ColorCurves,
  DirectionalLight,
  DefaultRenderingPipeline,
  DepthOfFieldEffectBlurLevel,
  Engine,
  GlowLayer,
  HemisphericLight,
  ImageProcessingConfiguration,
  Material,
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
import { EnemyHealthBars } from './vfx/EnemyHealthBars';
import { SpellVfxPresenter } from './vfx/SpellVfxPresenter';
import { castDuration } from './vfx/CombatVfxPlan';
import { BossTracker } from './BossTracker';
import { CombatFeel } from './render/CombatFeel';

/** Roughly head height above an enemy's feet. */
const HEALTH_BAR_OFFSET = new Vector3(0, 1.55, 0);

/** Matches DEFAULT_UI_SETTINGS.display.depthOfField; the store is the authority. */
const DEFAULT_DEPTH_OF_FIELD = 0.75;

/**
 * Sky, sun, rim, and up to two landmark lanterns already exceed Babylon's
 * default of four lights per material, and the excess is dropped silently -
 * so an actor walking past a shrine would lose its rim light with no error.
 */
const LIGHTS_PER_MATERIAL = 6;

/**
 * The finish, per quality tier. Measured at about 5% of median frame rate on a
 * mid-range desktop for the whole stack, which is cheap - but "low" exists for
 * machines where it is not, so the tier drops the effects that are pure polish
 * and keeps bloom, which is doing structural work for the spell VFX.
 */
const FINISH = {
  low: { samples: 1, bloomKernel: 32, grain: 0, sharpen: 0, aberration: 0 },
  medium: { samples: 4, bloomKernel: 48, grain: 4.5, sharpen: 0.22, aberration: 2.5 },
  high: { samples: 4, bloomKernel: 64, grain: 5.5, sharpen: 0.3, aberration: 3.2 },
} as const;

export class EvercastScene {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly mage: ActorVisual;
  private readonly actors: ActorAssets;
  private readonly world: WorldGenerator;
  private readonly shadows: ShadowGenerator;
  private readonly enemyMeshes = new Map<number, ActorVisual>();
  private readonly retiring: { id: number; actor: ActorVisual; remaining: number }[] = [];
  private readonly presentation: DefaultRenderingPipeline;
  private readonly healthBars: EnemyHealthBars;
  private readonly feel: CombatFeel;
  private readonly bosses = new BossTracker();
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

    const finish = FINISH[quality];
    const presentation = new DefaultRenderingPipeline('environment finish', true, this.scene, [camera]);
    this.presentation = presentation;
    presentation.samples = finish.samples;
    presentation.fxaaEnabled = true;

    // Bloom is what makes the spell work read as light rather than as coloured
    // geometry, so it is threshold-led: only the emissive VFX and the brightest
    // sky cross the line, and the diorama itself stays crisp underneath it.
    presentation.bloomEnabled = true;
    presentation.bloomThreshold = 0.7;
    presentation.bloomWeight = 0.45;
    presentation.bloomKernel = finish.bloomKernel;
    presentation.bloomScale = 0.6;

    // A little edge definition back after FXAA and the depth-of-field blur,
    // which is what keeps low-poly geometry reading as deliberate rather than
    // soft. Grain and aberration are almost subliminal at rest; CombatFeel
    // drives the aberration up on impact.
    presentation.sharpenEnabled = finish.sharpen > 0;
    presentation.sharpen.edgeAmount = finish.sharpen;
    presentation.sharpen.colorAmount = 1;
    presentation.grainEnabled = finish.grain > 0;
    presentation.grain.intensity = finish.grain;
    presentation.grain.animated = true;
    presentation.chromaticAberrationEnabled = finish.aberration > 0;
    presentation.chromaticAberration.aberrationAmount = finish.aberration;
    presentation.chromaticAberration.radialIntensity = 0.8;

    // Depth of field holds the combat lane sharp and softens the far hills and
    // the near verge, which is what makes the diorama read as a diorama.
    // Babylon measures focus distance in millimetres, and the camera radius is
    // pinned, so the plane of focus sits exactly on the road.
    presentation.depthOfFieldBlurLevel = DepthOfFieldEffectBlurLevel.Medium;
    // The mage sits ~17.4 units from the camera and the far end of a lane ~20.8,
    // so the plane of focus goes through the middle of the road. Aperture is
    // what actually decides how much is soft: lensSize / fStop. The Babylon
    // default of 50mm at f/1.4 leaves the whole scene inside the sharp band.
    presentation.depthOfField.focusDistance = 18500;
    presentation.depthOfField.focalLength = 85;
    presentation.depthOfField.fStop = 1.35;
    this.setDepthOfField(DEFAULT_DEPTH_OF_FIELD);
    this.scene.imageProcessingConfiguration.toneMappingEnabled = true;
    this.scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    this.scene.imageProcessingConfiguration.exposure = 1.2;
    this.scene.imageProcessingConfiguration.contrast = 1.04;
    this.scene.imageProcessingConfiguration.vignetteEnabled = true;
    this.scene.imageProcessingConfiguration.vignetteWeight = 1.25;
    this.scene.imageProcessingConfiguration.vignetteColor = new Color4(0.04, 0.055, 0.045, 0);

    // The film grade: warm highlights against cool shadows. It is the cheapest
    // thing in the whole pipeline that reads as "graded" rather than "rendered",
    // and it costs no texture - a LUT would be another binary asset.
    const grade = new ColorCurves();
    grade.globalSaturation = 8;
    grade.highlightsHue = 38;
    grade.highlightsDensity = 22;
    grade.highlightsSaturation = -6;
    grade.shadowsHue = 222;
    grade.shadowsDensity = 34;
    grade.shadowsSaturation = 16;
    this.scene.imageProcessingConfiguration.colorCurves = grade;
    this.scene.imageProcessingConfiguration.colorCurvesEnabled = true;

    this.scene.onNewMaterialAddedObservable.add((material: Material) => {
      if (material instanceof PBRMaterial || material instanceof StandardMaterial)
        material.maxSimultaneousLights = LIGHTS_PER_MATERIAL;
    });

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

    // The rim: a cool backlight from behind and above the lane, opposite the
    // sun. It contributes almost nothing to overall exposure and everything to
    // the silhouette, which is the whole trick behind the stylised look - the
    // characters are separated from the background by a line of light rather
    // than by an outline drawn on top of them.
    const rim = new DirectionalLight('rim', new Vector3(-0.38, -0.42, -0.86), this.scene);
    rim.intensity = 1.35;
    rim.diffuse = new Color3(0.56, 0.71, 1);
    rim.specular = new Color3(0.82, 0.89, 1);

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
    this.healthBars = new EnemyHealthBars(this.scene);
    this.feel = new CombatFeel({
      camera,
      pipeline: presentation,
      imageProcessing: this.scene.imageProcessingConfiguration,
    });
    this.vfx = new SpellVfxPresenter(pool, new CombatFxPresenter(pool, this.scene), {
      staff: () => this.mage.socketPosition('socket_spell', new Vector3(0.55, 1.65, 0)),
      mage: () => this.mage.root.position.add(new Vector3(0, 1, 0)),
      target: (id) =>
        this.enemyActor(id)?.root.position.add(new Vector3(0, 0.65, 0)) ??
        this.transientAnchors.get(id)?.position,
      actor: (id) => this.enemyActor(id),
    });

    // A handle for tuning the look from the console - toggling an effect off
    // and back on is the only honest way to tell whether it is earning its
    // place. Alongside the existing DEV-only biome key, and stripped in a
    // production build.
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).evercastScene = this;
    this.resize();
    this.engine.runRenderLoop(() => this.scene.render());
    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.keydown);
  }

  sync(snapshot: SimulationSnapshot, realDeltaSeconds: number, events: readonly GameEvent[]): void {
    this.bosses.note(events);
    this.feel.ingest(events, this.bosses.has);
    // Everything below runs on presentation time, which hit-stop can freeze or
    // slow. The simulation has already advanced on the real delta, so nothing
    // here can change what is true - only when it is drawn.
    const deltaSeconds = this.feel.update(realDeltaSeconds);
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
    // Bars follow the meshes, not the snapshot: enemies are walking in, and the
    // interface only hears about them ten times a second.
    this.healthBars.sync(snapshot.enemies, (instanceId: number) => {
      const actor = this.enemyMeshes.get(instanceId);
      return actor ? actor.root.position.add(HEALTH_BAR_OFFSET) : null;
    });
    this.healthBars.update();
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
    this.bosses.forget(events);
    if (this.mageRecovery > 0) {
      this.mageRecovery -= deltaSeconds;
      if (this.mageRecovery <= 0) this.mage.revive(walking);
    }
  }

  async whenReady(): Promise<void> {
    await Promise.all([this.actors.whenReady(), this.vfx.pool.ready]);
  }

  /**
   * `strength` runs 0 (off) to 1 (shallowest). Aperture is lensSize / fStop, so
   * that is the single knob worth exposing: focus stays on the road, and the
   * player decides how much of the world falls away from it.
   */
  setDepthOfField(strength: number): void {
    const clamped = Math.min(1, Math.max(0, strength));
    this.presentation.depthOfFieldEnabled = clamped > 0.02;
    if (clamped <= 0.02) return;
    this.presentation.depthOfField.lensSize = clamped * 560;
  }

  setDamageNumbersVisible(visible: boolean): void {
    this.vfx.combat.setDamageNumbersVisible(visible);
  }

  dispose(): void {
    this.feel.dispose();
    this.bosses.clear();
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.keydown);
    this.vfx.dispose();
    this.healthBars.dispose();
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
