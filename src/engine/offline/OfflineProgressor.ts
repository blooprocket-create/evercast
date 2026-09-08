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

export class OfflineProgressor {
  constructor(private readonly maxOfflineSeconds: number) {}

  apply(simulation: OfflineAdvanceable, elapsedSeconds: number): OfflineSummary {
    const secondsApplied = Math.max(0, Math.min(elapsedSeconds, this.maxOfflineSeconds));
    const before = simulation.getSnapshot();
    simulation.advance(secondsApplied, { presentationEvents: false });
    const after = simulation.getSnapshot();
    return {
      secondsApplied,
      stageBefore: before.stage,
      stageAfter: after.stage,
      kills: after.kills - before.kills,
      goldGained: quantity(big(after.gold.raw).sub(before.gold.raw)),
      essenceGained: quantity(big(after.essence.raw).sub(before.essence.raw)),
    };
  }
}
