import type {
  ArcRotateCamera,
  DefaultRenderingPipeline,
  ImageProcessingConfiguration,
} from '@babylonjs/core';
import type { GameEvent } from '../../engine/events/GameEvent';
import { planImpact } from './ImpactPlan';

/**
 * Turns `ImpactPlan`'s numbers into something the player feels: the camera is
 * thrown about, the picture freezes for a few frames, and the whole image
 * blooms.
 *
 * Shake goes through `targetScreenOffset` rather than the camera's target on
 * purpose. Moving the target would change the distance to the plane of focus,
 * so every hit would pull the scene in and out of focus; a screen-space offset
 * shakes the picture and leaves depth of field alone.
 */

/** Trauma bleeds off linearly - an exponential tail leaves the camera humming. */
const TRAUMA_DECAY = 1.9;
const FLASH_DECAY = 5.5;
/** Fast enough to read as an impact, slow enough not to strobe. */
const SHAKE_HZ = 17;
/**
 * World units of screen-space offset at full shake. The camera sits 17.5 units
 * back at a 0.68 fov, so the visible height there is about 12.4 units: 0.5 is
 * roughly 4% of the screen at maximum, and - because shake is trauma squared -
 * a stray hit still moves the picture by well under a pixel.
 */
const SHAKE_SCREEN = 0.5;
const SHAKE_FOV = 0.045;

/**
 * How long after a freeze before combat may freeze again.
 *
 * Without this, a fast build crits often enough that the picture is stopped
 * around eight percent of the time, which stops reading as punctuation and
 * starts reading as a bad frame rate. Climaxes ignore it.
 */
const FREEZE_REFRACTORY = 0.3;
const SLOW_MOTION_SECONDS = 0.34;
const SLOW_MOTION_RATE = 0.45;

const hash = (n: number): number => {
  const value = Math.sin(n * 127.1) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
};

/** Smooth value noise: a shake built from raw randomness buzzes instead of shakes. */
function noise(t: number, seed: number): number {
  const index = Math.floor(t);
  const fraction = t - index;
  const a = hash(index + seed);
  const b = hash(index + 1 + seed);
  const smooth = fraction * fraction * (3 - 2 * fraction);
  return a + (b - a) * smooth;
}

export interface CombatFeelTargets {
  camera: ArcRotateCamera;
  pipeline: DefaultRenderingPipeline;
  imageProcessing: ImageProcessingConfiguration;
}

export class CombatFeel {
  private trauma = 0;
  private flash = 0;
  private freeze = 0;
  private refractory = 0;
  private slowMotion = 0;
  private clock = 0;
  /** This frame's contribution, so it can be undone before the next one. */
  private fovOffset = 0;

  private readonly baseExposure: number;
  private readonly baseBloom: number;
  private readonly baseAberration: number;

  constructor(private readonly targets: CombatFeelTargets) {
    this.baseExposure = targets.imageProcessing.exposure;
    this.baseBloom = targets.pipeline.bloomWeight;
    this.baseAberration = targets.pipeline.chromaticAberration.aberrationAmount;
  }

  ingest(events: readonly GameEvent[], isBoss: (instanceId: number) => boolean): void {
    if (events.length === 0) return;
    const impact = planImpact(events, isBoss);
    // Whichever is stronger wins; a batch never stacks on top of a bigger one
    // still playing out, or a long fight would end up permanently shaking.
    this.trauma = Math.max(this.trauma, impact.trauma);
    this.flash = Math.max(this.flash, impact.flash);
    if (impact.hitStop > this.freeze && (impact.climax || this.refractory <= 0)) {
      this.freeze = impact.hitStop;
      this.refractory = FREEZE_REFRACTORY;
      if (impact.climax) this.slowMotion = SLOW_MOTION_SECONDS;
    }
  }

  /**
   * Applies this frame's shake and flash, and returns the delta presentation
   * should advance by. The simulation has already run on the real delta: this
   * only ever slows what is drawn, never what is true.
   */
  update(deltaSeconds: number): number {
    const { camera, pipeline, imageProcessing } = this.targets;

    let presentationDelta = deltaSeconds;
    if (this.freeze > 0) {
      const frozen = Math.min(deltaSeconds, this.freeze);
      this.freeze -= frozen;
      presentationDelta -= frozen;
    }
    if (this.slowMotion > 0 && this.freeze <= 0) {
      this.slowMotion = Math.max(0, this.slowMotion - presentationDelta);
      presentationDelta *= SLOW_MOTION_RATE;
    }

    // Everything below runs on real time: a frozen picture still has to shake
    // and flash, or the freeze reads as a stall rather than as a punch.
    this.clock += deltaSeconds;
    this.refractory = Math.max(0, this.refractory - deltaSeconds);
    this.trauma = Math.max(0, this.trauma - TRAUMA_DECAY * deltaSeconds);
    this.flash = Math.max(0, this.flash - FLASH_DECAY * deltaSeconds * (0.4 + this.flash));

    // Squared, so a stray hit is a nudge and a boss dying is an earthquake.
    const shake = this.trauma * this.trauma;
    const t = this.clock * SHAKE_HZ;
    camera.targetScreenOffset.set(
      noise(t, 0) * shake * SHAKE_SCREEN,
      noise(t, 31) * shake * SHAKE_SCREEN * 0.7,
    );

    camera.fov += this.fovOffset;
    this.fovOffset = shake * SHAKE_FOV;
    camera.fov -= this.fovOffset;

    imageProcessing.exposure = this.baseExposure * (1 + this.flash * 0.5);
    pipeline.bloomWeight = this.baseBloom + this.flash * 0.75;
    pipeline.chromaticAberration.aberrationAmount = this.baseAberration + this.flash * 26;

    return presentationDelta;
  }

  dispose(): void {
    const { camera, pipeline, imageProcessing } = this.targets;
    camera.targetScreenOffset.set(0, 0);
    camera.fov += this.fovOffset;
    this.fovOffset = 0;
    imageProcessing.exposure = this.baseExposure;
    pipeline.bloomWeight = this.baseBloom;
    pipeline.chromaticAberration.aberrationAmount = this.baseAberration;
  }
}
