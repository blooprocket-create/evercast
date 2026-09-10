import type { VoiceName } from './AudioCuePlan';

/**
 * The cross-batch half of the noise problem.
 *
 * `planAudio` budgets one batch, but batches arrive every frame: ten cues at
 * 60fps is six hundred voices a second, each of them two to four oscillators.
 * That is a melted audio thread and a wall of mush, from a plan that looks
 * perfectly reasonable one batch at a time.
 *
 * So each voice gets a minimum gap - long enough that repeats read as rhythm
 * rather than as buzz, short enough that a fast build still sounds fast - and
 * the whole engine gets a ceiling on how many voices may start per second.
 * Time is passed in, so this is testable without a clock.
 */
export const VOICE_MIN_GAP: Record<VoiceName, number> = {
  cast: 0.05,
  impact: 0.045,
  crit: 0.06,
  blast: 0.07,
  meteor: 0.13,
  surge: 0.45,
  perfect: 0.12,
  kill: 0.09,
  bossKill: 0.5,
  enemyAttack: 0.11,
  defeat: 1.5,
  levelUp: 0.06,
  awaken: 0.25,
  advance: 0.4,
  rebirth: 2,
};

/** Well above any musical rate, well below what the audio thread minds. */
export const VOICES_PER_SECOND = 48;

/**
 * The gap is a feel parameter, not a precise boundary, and comparing raw
 * floats makes it a knife-edge: `1 + 0.045 - 1` is `0.04499999999999993`, so a
 * voice scheduled exactly one gap later reads as too soon and is silently
 * dropped. A microsecond of slack is inaudible and removes the edge.
 */
const GAP_EPSILON = 1e-6;

export class VoiceThrottle {
  private readonly lastStart = new Map<VoiceName, number>();
  private windowStart = 0;
  private windowCount = 0;

  /** True when the voice may start at `now` (seconds), which it then records. */
  admit(voice: VoiceName, now: number): boolean {
    if (now - this.windowStart >= 1) {
      this.windowStart = now;
      this.windowCount = 0;
    }
    if (this.windowCount >= VOICES_PER_SECOND) return false;

    const last = this.lastStart.get(voice);
    // A rewound clock (a suspended context resuming) must not lock a voice out.
    if (last !== undefined && now >= last && now - last < VOICE_MIN_GAP[voice] - GAP_EPSILON) {
      return false;
    }

    this.lastStart.set(voice, now);
    this.windowCount += 1;
    return true;
  }

  reset(): void {
    this.lastStart.clear();
    this.windowStart = 0;
    this.windowCount = 0;
  }
}
