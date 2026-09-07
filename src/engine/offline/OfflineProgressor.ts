import type { QuantitySnapshot } from '../numbers';
import { big, quantity } from '../numbers';

export interface OfflineAdvanceable {
  getSnapshot(): {
    stage: number;
    kills: number;
    essence: QuantitySnapshot;
  };
  advance(seconds: number, options?: { presentationEvents?: boolean }): void;
}

export interface OfflineSummary {
  secondsApplied: number;
  stageBefore: number;
  stageAfter: number;
  kills: number;
  essenceGained: QuantitySnapshot;
}

export class OfflineProgressor {
  constructor(private readonly maxOfflineSeconds: number) {}

  apply(simulation: OfflineAdvanceable, elapsedSeconds: number): OfflineSummary {
    const secondsApplied = Math.max(0, Math.min(elapsedSeconds, this.maxOfflineSeconds));
    const before = simulation.getSnapshot();
    simulation.advance(secondsApplied, { presentationEvents: false });
    const after = simulation.getSnapshot();
    const essenceGained = big(after.essence.raw).sub(before.essence.raw);
    return {
      secondsApplied,
      stageBefore: before.stage,
      stageAfter: after.stage,
      kills: after.kills - before.kills,
      essenceGained: quantity(essenceGained),
    };
  }
}
