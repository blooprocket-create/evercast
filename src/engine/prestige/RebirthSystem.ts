import type { EngineConfig } from '../config';
import type { GameEvent } from '../events/GameEvent';
import type { GameState } from '../model';
import { big } from '../numbers';
import { createInitialRunState } from '../state';

export class RebirthSystem {
  constructor(
    private readonly config: EngineConfig,
    private readonly emit: (event: GameEvent) => void,
  ) {}

  canRebirth(state: GameState): boolean {
    return state.run.highestStageThisRun >= this.config.rebirthUnlockStage;
  }

  previewKnowledgeGain(state: GameState) {
    if (!this.canRebirth(state)) return big(0);
    const ratio = state.run.highestStageThisRun / this.config.rebirthUnlockStage;
    return big(Math.max(1, Math.floor(Math.pow(ratio, 1.5))));
  }

  perform(state: GameState): boolean {
    const gain = this.previewKnowledgeGain(state);
    if (gain.cmp(0) <= 0) return false;

    const elapsed = state.run.elapsedSeconds;
    state.meta.knowledge = state.meta.knowledge.add(gain);
    state.meta.rebirths += 1;
    state.run = createInitialRunState(this.config);
    this.emit({
      type: 'rebirth_performed',
      time: elapsed,
      knowledgeGained: gain.toString(),
      rebirths: state.meta.rebirths,
    });
    this.emit({
      type: 'resource_gained',
      time: elapsed,
      resource: 'knowledge',
      amount: gain.toString(),
    });
    return true;
  }
}
