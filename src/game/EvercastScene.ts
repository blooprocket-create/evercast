import {
  ArcRotateCamera,
  Color3,
  Color4,
  ColorCurves,
  DirectionalLight,
  DefaultRenderingPipeline,
  DepthOfFieldEffectBlurLevel,
  Engine,
  HemisphericLight,
  ImageProcessingConfiguration,
  Material,
  type Nullable,
  type Observer,
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
import { AtmosphereState, breatheOn } from './render/Atmosphere';
import { CombatFeel } from './render/CombatFeel';
import { watchContextLoss } from './render/ContextLoss';
import {
  type FrameRatePreference,
  type RenderProfile,
  frameRateCapFor,
  readDeviceFacts,
  renderProfileFor,
} from './render/DeviceProfile';
import { FrameGovernor } from './render/FrameGovernor';
import { LuminousGlow } from './render/LuminousGlow';
import { type CameraPose, applyPose, capturePose, titlePose } from './title/TitleFraming';
import {
  BASE_BETA,
  BASE_FOV,
  BASE_TARGET_X,
  CAMERA_RADIUS,
  framingFor,
  visibleSpan,
} from './render/Framing';
import { TitleSigil } from './title/TitleSigil';

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

/**
 * How early a frame may arrive against the deadline and still be drawn.
 *
 * Vsync jitter, and nothing more - a frame landing a hair before the deadline
 * it was aiming at should be taken rather than deferred a whole refresh. The
 * *aliasing* is handled by the deadline itself, in `drawFrame`, and this used
 * to be four milliseconds trying and failing to do both jobs at once.
 */
const FRAME_TOLERANCE_MS = 1;

/**
 * How long an enemy takes to arrive, and how long a body takes to go.
 *
 * Both are veils rather than animations - see `ActorVisual.materialise`. The
 * arrival is short enough to be over before the foe is anywhere near the
 * fight, and the departure runs out the end of the 1.8 seconds a corpse is
 * already kept for, so nothing is held on screen any longer than it was.
 */
const ARRIVAL_SECONDS = 0.55;
const DEPARTURE_SECONDS = 0.7;
/** How long a killed enemy lies there before it is disposed of. */
const RETIRE_SECONDS = 1.8;

export class EvercastScene {
  private readonly engine: Engine;
  private readonly camera: ArcRotateCamera;
  /** Non-null only while the boot gate is up. */
  private title: TitleSigil | null = null;
  private titleObserver: Nullable<Observer<Scene>> = null;
  private gamePose: CameraPose | null = null;
  private readonly scene: Scene;
  private readonly mage: ActorVisual;
  private readonly actors: ActorAssets;
  private readonly world: WorldGenerator;
  private readonly stopWatchingContext: () => void;
  private readonly shadows: ShadowGenerator;
  private readonly enemyMeshes = new Map<number, ActorVisual>();
  private readonly retiring: {
    id: number;
    actor: ActorVisual;
    remaining: number;
    fading: boolean;
  }[] = [];
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
  private readonly profile: RenderProfile;
  private readonly atmosphere = new AtmosphereState();
  private readonly governor: FrameGovernor;
  private minFrameMs = 0;
  private lastFrameAt = 0;
  /** When the next capped frame is due. See `drawFrame`. */
  private nextFrameAt = 0;

  constructor(
    canvas: HTMLCanvasElement,
    quality: VfxQuality = 'medium',
    profile: RenderProfile = renderProfileFor(readDeviceFacts()),
  ) {
    this.profile = profile;
    /*
     * `canvasTabIndex: -1` because Babylon's default is 1.
     *
     * A *positive* tabindex does not join the tab order, it jumps the queue:
     * every element carrying one is visited before every element that does not,
     * whatever the document says. So the diorama was the first thing a keyboard
     * player reached - ahead of the boot gate's own button - as an announced but
     * entirely inert stop, and every subsequent Tab cycle began there again.
     *
     * Nothing here wanted the focus: the camera takes no input (`attachControl`
     * is never called) and the one keyboard shortcut this class owns is bound to
     * `window`. It has to be set as an engine option rather than on the element,
     * because Babylon re-asserts `canvas.tabIndex = engine.canvasTabIndex` from
     * its pointer-move handler - an assignment to the canvas survives until the
     * player moves the mouse. `-1` rather than no attribute at all keeps
     * `.focus()` working for anything that ever does need to point at the
     * picture.
     */
    this.engine = new Engine(canvas, true, {
      preserveDrawingBuffer: false,
      stencil: true,
      canvasTabIndex: -1,
      /*
       * A hint rather than an instruction, and the honest one for this game on
       * both kinds of machine it runs on. On a laptop with two GPUs it asks for
       * the discrete one, which is what a 3D scene wants; on a phone there is
       * only ever one GPU and the hint is ignored. What actually keeps a phone
       * cool is the frame cap and the passes below, not this.
       */
      powerPreference: 'high-performance',
    });
    // Everything the device tier and the governor decide is spent through this
    // one call: above 1 the scene is drawn smaller and stretched back up.
    this.engine.setHardwareScalingLevel(profile.scaling);
    this.governor = new FrameGovernor({
      target: 60,
      base: profile.scaling,
      floor: profile.scalingFloor,
      ceiling: profile.scalingCeiling,
    });
    this.setFrameRate('auto');
    // A browser reclaims GPU resources from a backgrounded tab, so a long
    // absence can end with the context already gone. Babylon restores what it
    // can; this is only so that it is not silent when it happens.
    this.stopWatchingContext = watchContextLoss(this.engine);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.025, 0.035, 0.06, 1);

    const camera = new ArcRotateCamera(
      'camera',
      -Math.PI / 2,
      BASE_BETA,
      CAMERA_RADIUS,
      new Vector3(BASE_TARGET_X, 1.15, 1),
      this.scene,
    );
    // Pinned, and depended upon elsewhere: `Framing` derives every shot from
    // this radius, and CombatFeel's shake is calibrated against the 12.4 units
    // of visible height this radius and the base fov produce.
    camera.lowerRadiusLimit = CAMERA_RADIUS;
    camera.upperRadiusLimit = CAMERA_RADIUS;
    camera.fov = BASE_FOV;
    camera.minZ = 0.2;
    camera.maxZ = 180;
    camera.inputs.clear();
    this.camera = camera;

    /*
     * Two budgets, and the smaller of them wins on every line.
     *
     * `quality` is what the player asked for and `profile.effects` is what the
     * device can pay for without getting warm, so a phone set to High gets the
     * high bloom kernel and still no depth of field. Each of these is a full
     * screen-sized pass; on a handheld the stack below went from six to two.
     */
    const finish = FINISH[quality];
    const afford = profile.effects;
    const presentation = new DefaultRenderingPipeline('environment finish', true, this.scene, [camera]);
    this.presentation = presentation;
    presentation.samples = Math.min(finish.samples, profile.samples);
    presentation.fxaaEnabled = afford.fxaa;

    // Bloom is what makes the spell work read as light rather than as coloured
    // geometry, so it is threshold-led: only the emissive VFX and the brightest
    // sky cross the line, and the diorama itself stays crisp underneath it.
    presentation.bloomEnabled = true;
    // Raised with the exposure: at 1.38 a sunlit flower head crosses 0.7 and
    // blooms like a spell does, which is the one thing the threshold is for.
    presentation.bloomThreshold = 0.82;
    presentation.bloomWeight = 0.45;
    presentation.bloomKernel = finish.bloomKernel;
    presentation.bloomScale = 0.6;

    // A little edge definition back after FXAA and the depth-of-field blur,
    // which is what keeps low-poly geometry reading as deliberate rather than
    // soft. Grain and aberration are almost subliminal at rest; CombatFeel
    // drives the aberration up on impact.
    presentation.sharpenEnabled = afford.sharpen && finish.sharpen > 0;
    presentation.sharpen.edgeAmount = finish.sharpen;
    presentation.sharpen.colorAmount = 1;
    presentation.grainEnabled = afford.grain && finish.grain > 0;
    presentation.grain.intensity = finish.grain;
    presentation.grain.animated = true;
    presentation.chromaticAberrationEnabled = afford.aberration && finish.aberration > 0;
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
    // Lifted with the fill drop: half the ambient is half the light in every
    // shadow, and the exposure is what puts the midtones back where they were.
    this.scene.imageProcessingConfiguration.exposure = 1.38;
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
      // The catch-all. Everything that makes a PBR material on purpose installs
      // the plugin itself; this is for anything that arrives another way, and
      // it is idempotent so the overlap costs nothing.
      breatheOn(material, this.atmosphere);
    });

    const skyLight = new HemisphericLight('sky', new Vector3(0, 1, 0), this.scene);
    skyLight.intensity = 0.65;
    /*
     * Mid-afternoon rather than noon: about thirty-five degrees up, where a
     * four-metre tree lays five metres of shadow across the grass instead of
     * two under its own canopy.
     *
     * Lowering the sun was tried once before this and made the picture flatter,
     * which was the right observation about the wrong cause. The fill was the
     * problem - between the sky light and the rim, the sun was about a third of
     * the light in the scene, so its angle could not matter and its shadows had
     * almost nothing to remove. With `FILL_SCALE` and the rim corrected, the
     * same change is what finally gives the ground shape.
     *
     * The azimuth puts the source up-field rather than behind the lens, and
     * that half is not taste. Every term keyed to looking toward the sun -
     * the haze glow, the leaf translucency, the sky's own halo - is zero when
     * the sun is behind the camera, because there is no direction you can look
     * that finds it. With the source in front, foliage lights through and the
     * air down the road warms, which is what those terms were written for.
     *
     * The disc itself still never appears: the shot looks down fifteen degrees
     * with a vertical field of about thirty-nine, so nothing above four and a
     * half degrees of elevation is in frame, and a sun that low would lay
     * fifty-metre shadows. The sky keeps its disc for a biome that wants one.
     *
     * The position follows the direction rather than being authored beside it:
     * the shadow frustum is built around the light, so the two have to agree
     * about where the fight is or the map is pointed at empty grass.
     */
    const sun = new DirectionalLight('sun', new Vector3(0.66, -0.5, -0.3), this.scene);
    sun.direction.normalize();
    sun.position = sun.direction.scale(-26);
    sun.intensity = 1.5;
    sun.shadowMinZ = 1;
    sun.shadowMaxZ = 65;
    sun.shadowFrustumSize = profile.shadowSpan;
    this.shadows = new ShadowGenerator(profile.shadowMapSize, sun);
    this.shadows.usePercentageCloserFiltering = true;
    this.shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    this.shadows.bias = 0.0005;
    this.shadows.normalBias = 0.04;
    // Deep enough to read now that the key is carrying the lighting. The grade
    // is what makes them blue; this only decides how much light is left in them.
    this.shadows.setDarkness(0.16);

    // The rim: a cool backlight from behind and above the lane, opposite the
    // sun. It contributes almost nothing to overall exposure and everything to
    // the silhouette, which is the whole trick behind the stylised look - the
    // characters are separated from the background by a line of light rather
    // than by an outline drawn on top of them.
    const rim = new DirectionalLight('rim', new Vector3(-0.38, -0.42, -0.86), this.scene);
    /*
     * Halved, and it is doing the same job better for it.
     *
     * A rim light is meant to draw a line down a silhouette. At 1.35 against a
     * sun of about 2 it was a second key from the opposite side, filling in
     * exactly the shadow the sun was casting - which is most of why nothing in
     * this scene had a dark side. See `FILL_SCALE` in WorldGenerator.
     */
    rim.intensity = 0.68;
    rim.diffuse = new Color3(0.56, 0.71, 1);
    rim.specular = new Color3(0.82, 0.89, 1);

    new LuminousGlow(this.scene, profile.glowKernel, 0.32);
    this.world = new WorldGenerator(
      this.scene,
      skyLight,
      sun,
      this.shadows,
      profile,
      this.atmosphere,
    );
    this.actors = new ActorAssets(this.scene, this.shadows, undefined, this.atmosphere);
    // Before the mage, so every enemy model is in flight while the gate is up
    // rather than being requested during the 1.8 seconds of travel after it.
    this.actors.prewarm();
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
    this.engine.runRenderLoop(this.drawFrame);
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
      if (!entry.fading && entry.remaining <= DEPARTURE_SECONDS) {
        entry.fading = true;
        entry.actor.dissolve(DEPARTURE_SECONDS);
      }
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
          this.retiring.push({
            id: event.instanceId,
            actor: mesh,
            remaining: RETIRE_SECONDS,
            fading: false,
          });
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
          // A bar arrives with the foe it belongs to, not ahead of it.
          opacity: this.enemyMeshes.get(enemy.instanceId)?.solidity ?? 1,
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

  /**
   * Everything the boot gate is waiting on, and it has to be everything: a gate
   * that released on the mage alone still showed enemies popping in from
   * primitives and props arriving in load order, which is the one thing it
   * exists to hide.
   *
   * Settled rather than all, for the same reason the pieces below are: an asset
   * that failed has already degraded to a fallback, and the game is playable
   * without it. Only a wait with no end is worse than a missing prop, and
   * `ASSET_WAIT_CEILING_MS` covers that from the other side.
   */
  /**
   * Lifts the camera clear of the world and raises the title sigil.
   *
   * Resolves when the sigil is built *and* a frame carrying it has been
   * presented, and the boot gate waits on that before it lifts its curtain.
   * Both halves are load-bearing, and for different reasons:
   *
   *   - the rendered frame is what guarantees the player never sees the world
   *     assembling. Whatever state the diorama is in, the camera is already
   *     looking somewhere else by the time anything becomes see-through - it is
   *     ordering that keeps the promise, not opacity.
   *   - waiting on the meshes is what stops the curtain lifting on an empty
   *     void. The VFX pool has usually cached these same GLBs by now, but
   *     `ASSET_WAIT_CEILING_MS` can open the gate before it ever finished, and
   *     then the rings would arrive one at a time onto a title screen already
   *     in view - the exact pop-in the curtain exists to cover.
   *
   * The drift observer is attached *after* the meshes land rather than before,
   * which is the subtler half. It owns the ignition clock, so starting it at
   * construction would spend the two and a half seconds of fade-up while the
   * sigil was still invisible and loading - and a slow enough load would burn
   * the ignition entirely, snapping a fully lit sigil on screen the instant the
   * curtain moved.
   *
   * The camera moves rather than being replaced. `DefaultRenderingPipeline` is
   * built around this one camera, so a second would have had no bloom - and
   * bloom is the whole reason an additive sigil reads as light rather than as
   * coloured geometry.
   */
  async showTitle(): Promise<void> {
    if (this.title) return;
    this.gamePose = capturePose(this.camera);
    applyPose(this.camera, titlePose(this.gamePose));

    const sigil = new TitleSigil(this.scene);
    this.title = sigil;
    sigil.root.position.copyFrom(this.camera.target);
    this.applyDepthOfField();

    // Always settles, however the downloads went: a mesh that never arrived is
    // substituted rather than skipped, so this cannot leave the gate waiting.
    await sigil.ready;
    // Begin pressed, or the quality changed, while the meshes were in flight.
    if (this.title !== sigil) return;

    // The scene's own render loop is running; the game loop is not. This is what
    // drives the ignition and the drift until the player presses Begin.
    this.titleObserver = this.scene.onBeforeRenderObservable.add(() => {
      sigil.update(this.engine.getDeltaTime() / 1000);
    });

    await new Promise<void>((resolve) => {
      this.scene.onAfterRenderObservable.addOnce(() => resolve());
    });
  }

  /** Puts the camera back and tears the sigil down. Idempotent. */
  hideTitle(): void {
    if (!this.title) return;
    if (this.titleObserver) {
      this.scene.onBeforeRenderObservable.remove(this.titleObserver);
      this.titleObserver = null;
    }
    this.title.dispose();
    this.title = null;
    if (this.gamePose) applyPose(this.camera, this.gamePose);
    this.gamePose = null;
    // Back to whatever the player's display setting asks for.
    this.applyDepthOfField();
  }

  async whenReady(): Promise<void> {
    await Promise.allSettled([
      this.actors.whenReady(),
      this.vfx.pool.ready,
      this.world.whenReady(),
    ]);
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
    // The title is a composed frame, not a diorama. Depth of field exists to
    // hold the combat lane sharp against a soft background, and at the default
    // strength the aperture is wide enough that a sigil sitting a fraction off
    // the focal plane goes to mush. Nothing behind it needs separating, so the
    // effect has no work to do here.
    // A tier that cannot afford the pass never turns it on, whatever the slider
    // says - the setting is about taste, and this is about a phone staying cool.
    const strength = this.title || !this.profile.effects.depthOfField ? 0 : this.depthOfFieldStrength;
    this.presentation.depthOfFieldEnabled = strength > 0.02;
    if (strength <= 0.02) return;
    const fov = this.scene.activeCamera?.fov ?? BASE_FOV;
    this.presentation.depthOfField.lensSize = strength * 560 * (BASE_FOV / Math.max(BASE_FOV, fov));
  }

  setDamageNumbersVisible(visible: boolean): void {
    this.vfx.combat.setDamageNumbersVisible(visible);
  }

  /**
   * How many frames a second the renderer may draw.
   *
   * The simulation is event-driven and runs on its own clock, so this changes
   * nothing about what happens - only how often it is painted. On a handheld
   * that is the difference between a session and a warm phone, which is why
   * `auto` is thirty there and uncapped on anything with a fan.
   */
  setFrameRate(preference: FrameRatePreference): void {
    const cap = frameRateCapFor(preference, this.profile);
    this.minFrameMs = cap > 0 ? 1000 / cap : 0;
    // The old cadence says nothing about the new one; the next frame is due now.
    this.nextFrameAt = 0;
    // The governor judges the device against what it is now being asked for.
    // Uncapped, sixty is the bar - past that nobody is in trouble.
    this.governor.retarget({
      target: cap > 0 ? cap : 60,
      base: this.profile.scaling,
      floor: this.profile.scalingFloor,
      ceiling: this.profile.scalingCeiling,
    });
  }

  /**
   * One drawn frame: the cap, the governor, and the camera the air is seen from.
   *
   * The cap is enforced here rather than by slowing the loop down, because the
   * browser only offers frames at the display's refresh rate and the useful
   * thing to do with one that arrives too early is to decline it. Declining
   * costs nothing - no render, no shadow map, no post-process chain - which is
   * the whole point.
   */
  private readonly drawFrame = (): void => {
    const now = performance.now();
    if (this.minFrameMs > 0) {
      if (now < this.nextFrameAt - FRAME_TOLERANCE_MS) return;
      /*
       * The deadline advances by a whole frame from where it was, not from the
       * frame that was just drawn - which is what keeps a cap honest on a
       * display whose refresh is not a multiple of it.
       *
       * Measured against the old rule, which subtracted a fixed slack from the
       * gap since the last frame: a 60 cap on a 90Hz phone took every second
       * 11.1ms callback and produced 45fps, and the governor read that as a
       * device in trouble and traded resolution away for it. On 144Hz the same
       * rule produced 72. Advancing a deadline alternates one and two callbacks
       * and averages the number that was asked for. `Math.max` is the catch-up
       * clamp: after a stall the deadline is now, not a backlog of frames.
       */
      this.nextFrameAt = Math.max(now, this.nextFrameAt + this.minFrameMs);
    }
    const elapsed = now - this.lastFrameAt;
    this.lastFrameAt = now;

    const scaling = this.governor.sample(elapsed);
    if (scaling !== null) this.engine.setHardwareScalingLevel(scaling);

    // Where the air is being looked at from. A frame behind, because the camera
    // resolves its own position while rendering - and a frame of a camera that
    // is pinned to the road is not a distance anyone can see.
    this.atmosphere.eye.copyFrom(this.camera.globalPosition);
    this.scene.render();
  };

  dispose(): void {
    // Before anything else: a quality change disposes the scene while the title
    // effect's cleanup is still to run, and `hideTitle` must not touch a scene
    // that is already going away.
    this.hideTitle();
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
    const framing = framingFor(aspect);

    // Through CombatFeel rather than straight onto the camera: it is shaking
    // the fov around this value, and writing underneath it corrupts the base.
    this.feel.setBaseFov(framing.fov);
    this.camera.beta = framing.beta;

    /*
     * The aim is the one part of the shot the title screen is also using - it
     * is the same camera, lifted 400 units - so while the sigil is up the new
     * aim goes into the pose the camera will come back to, and the lift is
     * re-applied over it. Writing the live target there instead would leave
     * `hideTitle` restoring the aim from before the rotation.
     */
    if (this.gamePose) {
      this.gamePose.target.x = framing.targetX;
      this.gamePose.beta = framing.beta;
      applyPose(this.camera, titlePose(this.gamePose));
      if (this.title) this.title.root.position.copyFrom(this.camera.target);
    } else if (this.camera.target.x !== framing.targetX) {
      const target = this.camera.target.clone();
      target.x = framing.targetX;
      // `false` for cloneAlphaBetaRadius: see applyPose. A plain assignment
      // swings the camera instead of translating it.
      this.camera.setTarget(target, false, false, true);
    }

    // What the shot actually shows of the road, so the world can stop drawing
    // the chunks either side of it. See `WorldGenerator.setView`.
    this.world.setView(framing.targetX, visibleSpan(framing, aspect).width / 2);

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
    // Before any travel is spent: it decides how far a second of it goes.
    this.world.setZoneLength(snapshot.zoneLength);

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
        actor.materialise(ARRIVAL_SECONDS);
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
