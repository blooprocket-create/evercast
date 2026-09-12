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
  private applied = 0;
  private remaining: number;
  private readonly stageBefore: number;
  private stageAfter: number;
  /**
   * Tallied per batch rather than read off a first and last snapshot. Between
   * batches the caller is running live time and the player is free to spend, so
   * a global before-and-after would credit the away summary with live kills and
   * income - and a player who spent their gold would be shown a loss.
   */
  private kills = 0;
  private gold = big(0);
  private essence = big(0);

  constructor(
    private readonly simulation: OfflineAdvanceable,
    seconds: number,
    private readonly maxSecondsPerPeriod: number,
  ) {
    const start = simulation.getSnapshot();
    this.stageBefore = start.stage;
    this.stageAfter = start.stage;
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
    return this.advanceWhile(seconds, () => false);
  }

  /**
   * Applies slices until the debt is paid or `hasBudget` says stop, tallying the
   * batch as a whole. At least one slice is always applied, so a caller whose
   * budget is already spent still makes progress instead of spinning.
   *
   * The predicate is how the browser layer spends its own frame budget without
   * the engine ever reading a clock. A snapshot costs about as much as a second
   * of simulation, so the tally is taken once per batch: doing it per slice would
   * add more than half again to the cost of a day.
   */
  advanceWhile(sliceSeconds: number, hasBudget: () => boolean): number {
    if (this.done) return 0;

    const before = this.simulation.getSnapshot();
    let applied = 0;
    do {
      applied += this.applySlice(sliceSeconds);
    } while (!this.done && hasBudget());
    const after = this.simulation.getSnapshot();

    this.kills += after.kills - before.kills;
    this.gold = this.gold.add(big(after.gold.raw).sub(before.gold.raw));
    this.essence = this.essence.add(big(after.essence.raw).sub(before.essence.raw));
    this.stageAfter = after.stage;
    return applied;
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
    return {
      secondsApplied: this.applied,
      stageBefore: this.stageBefore,
      stageAfter: this.stageAfter,
      kills: this.kills,
      goldGained: quantity(this.gold),
      essenceGained: quantity(this.essence),
    };
  }

  private applySlice(seconds: number): number {
    const take = Math.min(Math.max(seconds, 0), this.remaining);
    if (take <= 0) return 0;
    this.simulation.advance(take, { presentationEvents: false });
    this.remaining -= take;
    this.applied += take;
    return take;
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
