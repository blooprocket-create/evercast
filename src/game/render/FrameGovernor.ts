/**
 * Resolution that answers to what the device is actually managing.
 *
 * `DeviceProfile` guesses a budget from what a device says about itself, and it
 * is a guess: two phones that report the same cores and the same screen can be
 * three years and a whole GPU generation apart, and neither of them tells you
 * that the case is already warm and the chip is being throttled to protect
 * itself. Thermal throttling is exactly the failure this exists for - it
 * arrives minutes in, on hardware that was comfortably fast at the start, and
 * no static profile can predict it because nothing about the device changed.
 *
 * So the profile picks the starting point and this moves it: sustained frames
 * under target trade resolution away, and sustained frames at target buy it
 * back. Resolution rather than an effect, because resolution is the one knob
 * that is continuous, has no visual cliff, and costs exactly what it saves.
 *
 * Pure, and deliberately slow to react. Every change resizes the whole
 * render-target chain, which is a hitch of its own - so a governor that
 * chased the frame rate would cost more than it saved.
 */

export interface GovernorSettings {
  /** Frames per second being aimed at; the cap when there is one, else 60. */
  target: number;
  /** Where the profile started, and the range it may be moved within. */
  base: number;
  floor: number;
  ceiling: number;
}

/** How long a verdict takes to reach. Long enough that a stall is not a trend. */
const WINDOW_MS = 1500;
/** One step of resolution. Coarse, because each one costs a resize. */
const STEP = 0.15;
/** Under this share of target, the device is not keeping up. */
const STRUGGLING = 0.86;
/** Over this share, it has room to spare. */
const COMFORTABLE = 0.97;
/**
 * Windows to wait after giving resolution back before taking more.
 *
 * Without it the governor oscillates: handing a pixel budget back is exactly
 * what makes the next window miss target, which takes it away again, forever.
 */
const SETTLE_WINDOWS = 3;
/**
 * A frame longer than this was not a slow frame. It is a tab coming back, a
 * garbage collection, or a save being written - and averaging it in would drop
 * the resolution of a session that is running perfectly well.
 */
const OUTLIER_MS = 250;

export class FrameGovernor {
  private level: number;
  private frames = 0;
  private elapsed = 0;
  private settling = 0;

  constructor(private settings: GovernorSettings) {
    this.level = clamp(settings.base, settings.floor, settings.ceiling);
  }

  /** The scaling level in force. */
  get scaling(): number {
    return this.level;
  }

  /**
   * Retargets without losing the level already reached.
   *
   * The player changing the frame cap changes what "keeping up" means, so the
   * window in flight was measured against the wrong number and is discarded -
   * but the resolution is not, because the device has not got any faster.
   */
  retarget(settings: GovernorSettings): void {
    this.settings = settings;
    this.level = clamp(this.level, settings.floor, settings.ceiling);
    this.reset();
  }

  /**
   * Feeds one drawn frame in. Returns a new scaling level when it changed, and
   * null - the overwhelmingly common case - when it did not.
   */
  sample(frameMs: number): number | null {
    if (!(frameMs > 0) || frameMs > OUTLIER_MS) return null;
    this.frames += 1;
    this.elapsed += frameMs;
    if (this.elapsed < WINDOW_MS) return null;

    const fps = (this.frames * 1000) / this.elapsed;
    const target = Math.max(1, this.settings.target);
    this.reset();

    if (this.settling > 0) {
      this.settling -= 1;
      return null;
    }
    if (fps < target * STRUGGLING) return this.moveTo(this.level + STEP, 0);
    if (fps > target * COMFORTABLE) {
      // Only giving resolution back is held down, and only for the reason in
      // SETTLE_WINDOWS: taking it away is a device in trouble, and waiting
      // three windows to help it is three seconds of stutter nobody asked for.
      return this.moveTo(this.level - STEP, SETTLE_WINDOWS);
    }
    return null;
  }

  /**
   * Reports only a move that actually moved.
   *
   * A step that clamps against the ceiling lands on the level already in force,
   * and announcing it would resize the whole render-target chain to the size it
   * is already - every window, for as long as the device stayed in trouble.
   */
  private moveTo(level: number, settling: number): number | null {
    const next = clamp(level, this.settings.floor, this.settings.ceiling);
    if (Math.abs(next - this.level) < STEP / 2) return null;
    this.level = next;
    this.settling = settling;
    return next;
  }

  private reset(): void {
    this.frames = 0;
    this.elapsed = 0;
  }
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
