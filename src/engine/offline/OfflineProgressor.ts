import type Decimal from 'break_eternity.js';
import type { QuantitySnapshot } from '../numbers';
import { big, quantity } from '../numbers';

export interface OfflineAdvanceable {
  getSnapshot(): {
    stage: number;
    kills: number;
    essence: QuantitySnapshot;
    gold: QuantitySnapshot;
    starlight: QuantitySnapshot;
  };
  advance(seconds: number, options?: { presentationEvents?: boolean }): void;
  creditOfflineYield(yields: { gold: Decimal; starlight: Decimal; kills: number }): void;
}

export interface OfflineSummary {
  secondsApplied: number;
  stageBefore: number;
  stageAfter: number;
  kills: number;
  goldGained: QuantitySnapshot;
  essenceGained: QuantitySnapshot;
  /** Away time the sample covered outright; the rest was credited from its rate. */
  secondsSimulated: number;
}

/**
 * How much of an absence is simulated event by event before the rest is credited
 * from the rate that window measured.
 *
 * Exact catch-up does not scale: the loop takes one step per world event, so a
 * day away from a played save is several hundred thousand steps and tens of
 * seconds of solid work - long enough that spending it before the first paint
 * reads as a game that will not start, and long enough that spreading it over
 * frames leaves the world visibly fast-forwarding for a minute. `ARCHITECTURE.md`
 * named this seam for exactly that, and this is the analytical strategy it meant.
 *
 * Ten minutes is long enough to average over travel, a boss, a death and the
 * farm fallback rather than whichever of those the run happens to be in at boot,
 * and short enough to stay imperceptible even on a slow phone.
 */
export const OFFLINE_SAMPLE_SECONDS = 600;

export class OfflineProgressor {
  constructor(
    private readonly maxOfflineSeconds: number,
    private readonly sampleSeconds = OFFLINE_SAMPLE_SECONDS,
  ) {}

  /**
   * Credits an absence and returns what it came to.
   *
   * An absence no longer than the sample is simulated outright, which is the
   * common case - a tab closed over lunch is exact. Past that, the sample sets a
   * per-second rate for the rewards that repeat, and the remainder is paid at
   * that rate. Cost is bounded by the sample rather than by how long the player
   * was gone, so a day and a week cost the same.
   */
  apply(simulation: OfflineAdvanceable, elapsedSeconds: number): OfflineSummary {
    const owed = clampSeconds(elapsedSeconds, this.maxOfflineSeconds);
    const before = simulation.getSnapshot();
    if (owed <= 0) return summaryOf(before, before, 0, 0);

    const sampled = Math.min(owed, this.sampleSeconds);
    simulation.advance(sampled, { presentationEvents: false });
    const afterSample = simulation.getSnapshot();

    const remaining = owed - sampled;
    if (remaining <= 0) return summaryOf(before, afterSample, owed, sampled);

    // Rates come from the sample and nothing else, so a run that spent it dying
    // and farming is credited for dying and farming.
    const scale = remaining / sampled;
    simulation.creditOfflineYield({
      gold: gained(afterSample.gold, before.gold).mul(scale),
      starlight: gained(afterSample.starlight, before.starlight).mul(scale),
      kills: (afterSample.kills - before.kills) * scale,
    });

    return summaryOf(before, simulation.getSnapshot(), owed, sampled);
  }
}

function summaryOf(
  before: ReturnType<OfflineAdvanceable['getSnapshot']>,
  after: ReturnType<OfflineAdvanceable['getSnapshot']>,
  secondsApplied: number,
  secondsSimulated: number,
): OfflineSummary {
  return {
    secondsApplied,
    secondsSimulated,
    stageBefore: before.stage,
    stageAfter: after.stage,
    kills: after.kills - before.kills,
    goldGained: quantity(gained(after.gold, before.gold)),
    essenceGained: quantity(gained(after.essence, before.essence)),
  };
}

function gained(after: QuantitySnapshot, before: QuantitySnapshot): Decimal {
  return big(after.raw).sub(before.raw);
}

function clampSeconds(seconds: number, max: number): number {
  if (!Number.isFinite(seconds)) return 0;
  return Math.max(0, Math.min(seconds, max));
}
