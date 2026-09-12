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
import { CompanionPresenter } from './CompanionPresenter';
import { VfxPool, type VfxQuality } from './vfx/VfxPool';
import { CombatFxPresenter } from './vfx/CombatFxPresenter';
import { WorldHealthBars } from './vfx/WorldHealthBars';
import { SpellVfxPresenter } from './vfx/SpellVfxPresenter';
import { castDuration } from './vfx/CombatVfxPlan';
import { BossTracker } from './BossTracker';
import { CombatFeel } from './render/CombatFeel';
import { watchContextLoss } from './render/ContextLoss';

/** Roughly head height above an enemy's feet. */
const HEALTH_BAR_OFFSET = new Vector3(0, 1.55, 0);

/** Matches DEFAULT_UI_SETTINGS.display.depthOfField; the store is the authority. */
const DEFAULT_DEPTH_OF_FIELD = 0.75;

/**
 * The framing everything else is calibrated against: the camera radius, the
 * depth-of-field aperture and CombatFeel's shake were all measured here.
 */
const BASE_FOV = 0.68;

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
  private readonly stopWatchingContext: () => void;
  private readonly shadows: ShadowGenerator;
  private readonly enemyMeshes = new Map<number, ActorVisual>();
  private readonly retiring: { id: number; actor: ActorVisual; remaining: number }[] = [];
  private readonly presentation: DefaultRenderingPipeline;
  private readonly healthBars: WorldHealthBars;
  private readonly partyBars: WorldHealthBars;
  private readonly companions: CompanionPresenter;
  private readonly feel: CombatFeel;
  private readonly bosses = new BossTracker();
  readonly vfx: SpellVfxPresenter;
  private readonly transientAnchors = new Map<number, { position: Vector3; remaining: number }>();
  private gearSignature = '';
  private mageRecovery = 0;
  private journeyInitialized = false;
  private visualFrontierStage = 1;
  private pendingWorldTravelSeconds = 0;
  private pendingResize: number | null = null;
  private depthOfFieldStrength = DEFAULT_DEPTH_OF_FIELD;
  private readonly canvasObserver?: ResizeObserver;

  constructor(canvas: HTMLCanvasElement, quality: VfxQuality = 'medium') {
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true });
    // A browser reclaims GPU resources from a backgrounded tab, so a long
    // absence can end with the context already gone. Babylon restores what it
    // can; this is only so that it is not silent when it happens.
    this.stopWatchingContext = watchContextLoss(this.engine);
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
    // Pinned, and depended upon elsewhere: resize() below derives its portrait
    // fov from `2 * radius`, and CombatFeel's shake is calibrated against the
    // 12.4 units of visible height this radius and fov produce.
    camera.lowerRadiusLimit = 17.5;
    camera.upperRadiusLimit = 17.5;
    camera.fov = BASE_FOV;
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
    // Measured to feet level: the mage sits ~16.9 units from the camera, the
    // contact arc 16.2-17.5, the edge of spell range ~18.7 and the far end of a
    // lane ~20.8. The plane of focus therefore belongs just past the fight, not
    // out on the road - further back and the enemies still walking in are the
    // sharp ones. Aperture is what actually decides how much is soft:
    // lensSize / fStop. The Babylon default of 50mm at f/1.4 leaves the whole
    // scene inside the sharp band.
    presentation.depthOfField.focusDistance = 17300;
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
    // The engine holds the mage at the origin and measures every reach from
    // there. Standing him anywhere else silently adds that offset to the reach
    // of every enemy in the game, on screen if not in the simulation.
    this.mage.root.position.set(0, 0.025, 0);
    this.mage.root.rotation.y = Math.PI * 0.68;
    const pool = new VfxPool(this.scene, quality);
    this.healthBars = new WorldHealthBars(this.scene, 'foe');
    this.partyBars = new WorldHealthBars(this.scene, 'ally');
    this.feel = new CombatFeel({
      camera,
      pipeline: presentation,
      imageProcessing: this.scene.imageProcessingConfiguration,
    });
    const combatFx = new CombatFxPresenter(pool, this.scene);
    this.companions = new CompanionPresenter(
      this.scene,
      {
        enemyAnchor: (id) =>
          this.enemyActor(id)?.root.position.add(new Vector3(0, 0.85, 0)) ??
          this.transientAnchors.get(id)?.position,
        numbers: combatFx.numbers,
      },
      this.shadows,
    );
    this.vfx = new SpellVfxPresenter(pool, combatFx, {
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
    window.addEventListener('resize', this.scheduleResize);
    window.addEventListener('orientationchange', this.scheduleResize);
    if (typeof ResizeObserver !== 'undefined') {
      this.canvasObserver = new ResizeObserver(this.scheduleResize);
      this.canvasObserver.observe(canvas);
    }
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
    // After the anchors, never before. A companion can hit an enemy that
    // spawned in this same publish - and one that spawned and died in it - so
    // reacting ahead of `transientAnchors` and `syncEnemyVisuals` looked up a
    // target nothing had placed yet and silently dropped the number. This is
    // where `vfx.ingest` already reads the field from, for the same reason.
    this.companions.sync(snapshot, deltaSeconds, events);
    // Bars follow the meshes, not the snapshot: enemies are walking in, and the
    // interface only hears about them ten times a second.
    this.healthBars.sync(
      // The boss owns the banner at the top of the screen, not a floating bar.
      snapshot.enemies
        .filter((enemy) => !enemy.boss)
        .map((enemy) => ({
          id: enemy.instanceId,
          hpPercent: enemy.hpPercent,
          hp: enemy.hp.display,
          maxHp: enemy.maxHp.display,
        })),
      (instanceId: number) => {
        const actor = this.enemyMeshes.get(instanceId);
        return actor ? actor.root.position.add(HEALTH_BAR_OFFSET) : null;
      },
    );
    this.healthBars.update();
    // The party wears the same bars in ally colours: a companion draining is
    // the thing that tells you the front line is about to break.
    this.partyBars.sync(this.companions.healthBarTargets(snapshot), (slot) =>
      this.companions.headOf(slot),
    );
    this.partyBars.update();
    for (const event of events) {
      if (event.type === 'spell_cast') this.mage.play('attack', castDuration(snapshot.castInterval));
      // The swing is played from the windup so it leads the blow, rather than
      // animating a hit the mage has already taken.
      if (event.type === 'enemy_windup')
        this.enemyMeshes.get(event.instanceId)?.play('attack', event.durationSeconds);
      if (event.type === 'enemy_attack') this.mage.play('hit');
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
    this.depthOfFieldStrength = Math.min(1, Math.max(0, strength));
    this.applyDepthOfField();
  }

  /**
   * Aperture scaled against the framing.
   *
   * `focusDistance` is measured to the combat lane and the aperture was
   * calibrated at the desktop fov of 0.68. A phone in portrait widens the fov
   * to about 1.03 to keep both formations in frame, which puts far more depth
   * inside the picture - and at a fixed aperture that arrives as the whole
   * diorama going soft. Opening the lens less as the view widens keeps the band
   * that is actually sharp roughly the same fraction of the shot, so portrait
   * and landscape read alike.
   */
  private applyDepthOfField(): void {
    const strength = this.depthOfFieldStrength;
    this.presentation.depthOfFieldEnabled = strength > 0.02;
    if (strength <= 0.02) return;
    const fov = this.scene.activeCamera?.fov ?? BASE_FOV;
    this.presentation.depthOfField.lensSize = strength * 560 * (BASE_FOV / Math.max(BASE_FOV, fov));
  }

  setDamageNumbersVisible(visible: boolean): void {
    this.vfx.combat.setDamageNumbersVisible(visible);
  }

  dispose(): void {
    this.stopWatchingContext();
    this.feel.dispose();
    this.bosses.clear();
    window.removeEventListener('resize', this.scheduleResize);
    window.removeEventListener('orientationchange', this.scheduleResize);
    this.canvasObserver?.disconnect();
    if (this.pendingResize !== null) cancelAnimationFrame(this.pendingResize);
    window.removeEventListener('keydown', this.keydown);
    this.vfx.dispose();
    this.healthBars.dispose();
    this.partyBars.dispose();
    this.transientAnchors.clear();
    for (const mesh of this.enemyMeshes.values()) mesh.dispose();
    this.enemyMeshes.clear();
    for (const entry of this.retiring) entry.actor.dispose();
    this.retiring.length = 0;
    this.mage.dispose();
    this.companions.dispose();
    this.actors.dispose();
    this.world.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }

  private readonly resize = (): void => {
    this.engine.resize();
    const aspect = this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight());
    // Keep both combat formations in frame on portrait screens. Through
    // CombatFeel rather than straight onto the camera: it is shaking the fov
    // around this value, and writing underneath it corrupts the base.
    this.feel.setBaseFov(Math.max(BASE_FOV, 2 * Math.atan(11 / (35 * aspect))));
    // The aperture is calibrated against the base framing, so it moves with it.
    this.applyDepthOfField();
  };

  /**
   * Rotating a phone is not one clean resize event.
   *
   * `orientationchange` arrives before the viewport has settled, `resize` can
   * fire several times with transitional dimensions, and some mobile browsers
   * report stale `innerWidth`/`innerHeight` throughout. So every signal is
   * taken, and the actual work is coalesced onto the next frame - by which
   * point the canvas box is real. A ResizeObserver on the canvas is the
   * authority, because it fires on what actually changed rather than on what
   * the window thinks happened.
   */
  private readonly scheduleResize = (): void => {
    if (this.pendingResize !== null) return;
    this.pendingResize = requestAnimationFrame(() => {
      this.pendingResize = null;
      this.resize();
    });
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
        actor.root.scaling.setAll(enemy.boss ? 1.12 : 1);
        actor.root.position.copyFrom(destination).addInPlace(new Vector3(0.45, 0, 0));
        this.enemyMeshes.set(enemy.instanceId, actor);
      }
      // The scene gets a fresh snapshot every frame, so this smoothing is pure
      // lag against a position already known exactly; at rate 7 it trailed by
      // 0.34 units, a third of melee reach. Kept, but tight - it also runs on
      // presentation time, so hit-stop freezes the actors with the picture.
      Vector3.LerpToRef(
        actor.root.position,
        destination,
        1 - Math.exp(-deltaSeconds * 18),
        actor.root.position,
      );
      // Face the mage, then bias toward the camera by the same angle the old
      // fixed yaw used, so a flanker turns in without going full profile.
      actor.root.rotation.y = Math.atan2(-actor.root.position.x, -actor.root.position.z) - 0.565;
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
