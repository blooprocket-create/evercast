import type { QuantitySnapshot } from '../numbers';
import { big, quantity } from '../numbers';

export interface OfflineAdvanceable {
  getSnapshot(): {
    stage: number;
    kills: number;
    essence: QuantitySnapshot;
    gold: QuantitySnapshot;
  };
  advance(seconds: number, options?: { presentationEvents?: boolean }): void;
}

export interface OfflineSummary {
  secondsApplied: number;
  stageBefore: number;
  stageAfter: number;
  kills: number;
  goldGained: QuantitySnapshot;
  essenceGained: QuantitySnapshot;
}

/**
 * Away time applied a slice at a time.
 *
 * A day of catch-up is hundreds of thousands of world events, which is seconds
 * of solid work - long enough that doing it in one pass before the first paint
 * reads as a game that will not start. So the caller drives it instead, and
 * decides how much to spend before yielding. The engine's own rule that `step`
 * never consumes past an event is what makes this safe: a run advanced in one
 * pass and the same run advanced in slices land on identical state.
 */
export class OfflineCatchUp {
  private readonly before: ReturnType<OfflineAdvanceable['getSnapshot']>;
  private applied = 0;
  private remaining: number;

  constructor(
    private readonly simulation: OfflineAdvanceable,
    seconds: number,
    private readonly maxSecondsPerPeriod: number,
  ) {
    this.before = simulation.getSnapshot();
    this.remaining = clampPeriod(seconds, maxSecondsPerPeriod);
  }

  get remainingSeconds(): number {
    return this.remaining;
  }

  get done(): boolean {
    return this.remaining <= 0;
  }

  /** Applies up to `seconds` of the outstanding time; returns what it applied. */
  advance(seconds: number): number {
    const take = Math.min(Math.max(seconds, 0), this.remaining);
    if (take <= 0) return 0;
    this.simulation.advance(take, { presentationEvents: false });
    this.remaining -= take;
    this.applied += take;
    return take;
  }

  /**
   * Folds another away period into this one. Each period is capped in its own
   * right, so two separate absences are not made to share one cap.
   */
  extend(seconds: number): void {
    this.remaining += clampPeriod(seconds, this.maxSecondsPerPeriod);
  }

  /** What has been applied so far, ready to show the player. */
  summary(): OfflineSummary {
    const after = this.simulation.getSnapshot();
    return {
      secondsApplied: this.applied,
      stageBefore: this.before.stage,
      stageAfter: after.stage,
      kills: after.kills - this.before.kills,
      goldGained: quantity(big(after.gold.raw).sub(this.before.gold.raw)),
      essenceGained: quantity(big(after.essence.raw).sub(this.before.essence.raw)),
    };
  }
}

function clampPeriod(seconds: number, max: number): number {
  if (!Number.isFinite(seconds)) return 0;
  return Math.max(0, Math.min(seconds, max));
}

export class OfflineProgressor {
  constructor(private readonly maxOfflineSeconds: number) {}

  /** A catch-up the caller advances in slices, as its own frame budget allows. */
  begin(simulation: OfflineAdvanceable, elapsedSeconds: number): OfflineCatchUp {
    return new OfflineCatchUp(simulation, elapsedSeconds, this.maxOfflineSeconds);
  }

  /** The whole catch-up in one pass, for callers that can afford to block. */
  apply(simulation: OfflineAdvanceable, elapsedSeconds: number): OfflineSummary {
    const catchUp = this.begin(simulation, elapsedSeconds);
    catchUp.advance(catchUp.remainingSeconds);
    return catchUp.summary();
  }
}
