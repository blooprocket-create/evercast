/**
 * What the renderer is allowed to spend, decided once from the device.
 *
 * A phone is not a slow desktop, and the difference that matters is not frame
 * rate - it is heat. A handheld has no fan and a battery, so a renderer that
 * merely *reaches* sixty frames on it will reach them for four minutes and then
 * be throttled to half of that for the rest of the session, with the case warm
 * enough to notice. An idle game is the worst possible shape for that: nobody
 * plays it for ninety seconds, and the fight runs whether or not anyone is
 * watching.
 *
 * So the tiers below are budgets rather than quality presets. They cut the
 * things that cost every frame forever - a whole extra scene pass for the glow,
 * a 2048 shadow map, five screen-sized post-process passes, sixty frames a
 * second of all of it - and leave the things that cost once.
 *
 * Pure on purpose: `readDeviceFacts` is the only part that touches a browser,
 * so the policy itself is testable at every shape of device rather than only on
 * whatever the developer happens to be holding.
 */

/** Everything a profile is decided from. Read once, when the scene is built. */
export interface DeviceFacts {
  /** `window.devicePixelRatio`, or 1 where there is none. */
  pixelRatio: number;
  /** The longest edge of the viewport, in CSS pixels. */
  viewportLongEdge: number;
  /** `navigator.hardwareConcurrency`; 0 when the browser withholds it. */
  cores: number;
  /** `navigator.deviceMemory`, in GiB; 0 when withheld - Safari never reports it. */
  memoryGb: number;
  /** A fingertip rather than a mouse: `(pointer: coarse)`. */
  coarsePointer: boolean;
  /** `prefers-reduced-motion: reduce`. */
  reducedMotion: boolean;
}

export type RenderTier = 'handheld' | 'tablet' | 'desktop';

/** Which finishing passes a tier can afford. Each one is a full-screen pass. */
export interface FinishingEffects {
  depthOfField: boolean;
  grain: boolean;
  sharpen: boolean;
  aberration: boolean;
  fxaa: boolean;
}

export interface RenderProfile {
  tier: RenderTier;
  /**
   * Babylon's hardware scaling level: 1 draws one backing pixel per CSS pixel,
   * and above 1 draws fewer and upscales. The starting point only - the frame
   * governor moves it between `scalingFloor` and `scalingCeiling` from there.
   */
  scaling: number;
  scalingFloor: number;
  scalingCeiling: number;
  /**
   * Frames per second the renderer may draw, before the player's own setting
   * overrides it. 0 means every frame the browser offers.
   *
   * This is the single biggest thermal lever there is, because it scales
   * everything else linearly: half the frames is half the GPU work, half the
   * draw calls, half the shadow maps and half the heat, and the simulation is
   * event-driven so none of it touches what is true.
   */
  frameCap: number;
  /** MSAA on the main colour target. */
  samples: number;
  shadowMapSize: number;
  /**
   * How wide a band of road the sun's shadow map covers, in world units.
   *
   * It does two things at once, which is why it moves with the tier rather than
   * being pinned: it decides how many props are inside the shadow frustum at
   * all, and it decides how many texels each of them gets. A 512 map over the
   * desktop's 38 units is mush; over sixteen it is a shadow.
   */
  shadowSpan: number;
  /** Chunks kept built behind and ahead of the camera. */
  chunksBehind: number;
  chunksAhead: number;
  /** Ground-cover props authored per chunk. */
  groundCover: number;
  /** Scatter tufts baked into each chunk's single detail mesh. */
  groundDetail: number;
  motes: number;
  glowKernel: number;
  effects: FinishingEffects;
}

const DESKTOP: RenderProfile = {
  tier: 'desktop',
  scaling: 1,
  scalingFloor: 1,
  scalingCeiling: 1.5,
  frameCap: 0,
  samples: 4,
  shadowMapSize: 2048,
  shadowSpan: 38,
  chunksBehind: 2,
  chunksAhead: 3,
  groundCover: 22,
  groundDetail: 150,
  motes: 22,
  glowKernel: 24,
  effects: { depthOfField: true, grain: true, sharpen: true, aberration: true, fxaa: true },
};

const TABLET: RenderProfile = {
  ...DESKTOP,
  tier: 'tablet',
  scalingCeiling: 1.6,
  frameCap: 60,
  samples: 1,
  shadowMapSize: 1024,
  shadowSpan: 26,
  chunksAhead: 2,
  groundCover: 16,
  groundDetail: 110,
  motes: 16,
  glowKernel: 16,
  // Depth of field is three passes and a blur chain; it is the one finishing
  // effect on this list that costs more than the whole of the rest together.
  effects: { depthOfField: false, grain: false, sharpen: true, aberration: true, fxaa: true },
};

const HANDHELD: RenderProfile = {
  ...TABLET,
  tier: 'handheld',
  scalingCeiling: 1.8,
  /*
   * Thirty rather than sixty, and it is not a compromise the player is paying
   * for on the picture.
   *
   * Nothing in this diorama moves at speed: the camera is pinned, the mage
   * stands still between casts, and the fastest thing on screen is an enemy
   * walking in at 2.4 units a second. What sixty frames buys on a phone is a
   * warm case and a battery that empties over a session nobody meant to time.
   * `frameRateCapFor` lets anyone who disagrees say so.
   */
  frameCap: 30,
  shadowMapSize: 512,
  shadowSpan: 16,
  chunksBehind: 1,
  chunksAhead: 2,
  groundCover: 10,
  groundDetail: 70,
  motes: 10,
  glowKernel: 12,
  effects: { depthOfField: false, grain: false, sharpen: false, aberration: false, fxaa: true },
};

/**
 * A viewport this wide has never been a phone, whatever it reports about its
 * pointer - a touchscreen laptop and an external display both land here.
 */
const DESKTOP_LONG_EDGE = 1280;
/** Below this, the longest edge belongs to a phone rather than to a tablet. */
const HANDHELD_LONG_EDGE = 950;

/**
 * The tier this device gets.
 *
 * A coarse pointer is the one fact worth trusting on its own: no desktop has
 * one by default, and every phone and tablet does. Everything after it is
 * separating a phone from a tablet, and then catching the genuinely weak
 * machine that reports a mouse - a cheap Chromebook, a five-year-old laptop,
 * a virtual desktop - because the finishing passes hurt those too.
 */
export function renderTierFor(facts: DeviceFacts): RenderTier {
  if (facts.coarsePointer) {
    return facts.viewportLongEdge >= DESKTOP_LONG_EDGE
      ? 'tablet'
      : facts.viewportLongEdge < HANDHELD_LONG_EDGE
        ? 'handheld'
        : 'tablet';
  }
  // Withheld is not weak: Safari reports neither, and reporting nothing must
  // not cost a Mac its finish. Only a number that is present and small counts.
  const weakCpu = facts.cores > 0 && facts.cores <= 2;
  const weakMemory = facts.memoryGb > 0 && facts.memoryGb <= 2;
  return weakCpu && weakMemory ? 'tablet' : 'desktop';
}

export function renderProfileFor(facts: DeviceFacts): RenderProfile {
  const tier = renderTierFor(facts);
  const base = tier === 'handheld' ? HANDHELD : tier === 'tablet' ? TABLET : DESKTOP;

  /*
   * A phone with a tall, dense screen is drawing more pixels for the same
   * picture, and it is the pixel count rather than the pixel ratio that costs:
   * a 1280-wide tablet at ratio 2 is asking for four times the fill of a
   * 360-wide phone at ratio 2, on a chip that is not four times the size.
   *
   * Babylon is built with `adaptToDeviceRatio` off, so the backing store is
   * already CSS-pixel sized and this only ever trades *further* down - and only
   * on the tiers that have no fan.
   */
  const dense = facts.pixelRatio >= 2 && facts.viewportLongEdge >= HANDHELD_LONG_EDGE;
  const scaling = tier === 'desktop' || !dense ? base.scaling : base.scaling * 1.2;

  return {
    ...base,
    scaling,
    scalingFloor: Math.min(base.scalingFloor, scaling),
    scalingCeiling: Math.max(base.scalingCeiling, scaling),
    // Reduced motion is a request about the picture, not about the machine, but
    // the drifting motes are the one thing in the world that answers to it.
    motes: facts.reducedMotion ? 0 : base.motes,
  };
}

/** The player's own frame-rate choice, `auto` deferring to the tier. */
export type FrameRatePreference = 'auto' | 'battery' | 'smooth' | 'unlimited';

export function frameRateCapFor(
  preference: FrameRatePreference,
  profile: Pick<RenderProfile, 'frameCap'>,
): number {
  switch (preference) {
    case 'battery':
      return 30;
    case 'smooth':
      return 60;
    case 'unlimited':
      return 0;
    default:
      return profile.frameCap;
  }
}

/**
 * The impure half: one read of the browser, so everything above it stays a
 * function of plain numbers.
 *
 * Every lookup is guarded. `matchMedia` throws on some embedded webviews,
 * `deviceMemory` exists only on Chromium, and a scene built in a test has no
 * window at all - none of which is worth a renderer that refuses to start, so
 * anything missing reads as the conservative answer rather than as an error.
 */
export function readDeviceFacts(view: Window | undefined = globalThis.window): DeviceFacts {
  const query = (media: string): boolean => {
    try {
      return view?.matchMedia?.(media).matches ?? false;
    } catch {
      return false;
    }
  };
  const navigatorish = view?.navigator as (Navigator & { deviceMemory?: number }) | undefined;
  const width = view?.innerWidth ?? 0;
  const height = view?.innerHeight ?? 0;

  return {
    pixelRatio: view?.devicePixelRatio && view.devicePixelRatio > 0 ? view.devicePixelRatio : 1,
    viewportLongEdge: Math.max(width, height) || DESKTOP_LONG_EDGE,
    cores: navigatorish?.hardwareConcurrency ?? 0,
    memoryGb: navigatorish?.deviceMemory ?? 0,
    coarsePointer: query('(pointer: coarse)'),
    reducedMotion: query('(prefers-reduced-motion: reduce)'),
  };
}
