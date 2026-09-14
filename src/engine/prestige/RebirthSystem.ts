import { KNOWLEDGE_STAGE_EXPONENT } from '../../content/rebirthTuning';
import type { EngineConfig } from '../config';
import type { GameEvent } from '../events/GameEvent';
import { mageMaxHealth } from '../gear/GearSystem';
import type { GameState } from '../model';
import { big } from '../numbers';
import { createInitialRunState } from '../state';

export class RebirthSystem {
  constructor(
    private readonly config: EngineConfig,
    private readonly emit: (event: GameEvent) => void,
  ) {}

  /**
   * What a run this deep is worth in total, ever - not what this Rebirth pays.
   *
   * A Rebirth keeps equipment and gold, so a player who has been to stage 250
   * can re-reach the unlock stage in a few minutes. Paying the full worth every
   * time made that the best play in the game by a wide margin: measured on the
   * real engine, spamming shallow rebirths earned 10.9 Knowledge per hour
   * against 1.8 for pushing as deep as a run could go. Attaching a power
   * multiplier to Knowledge would have turned a pointless exploit into the
   * dominant strategy.
   */
  private knowledgeWorth(state: GameState) {
    if (state.run.highestStageThisRun < this.config.rebirthUnlockStage) return big(0);
    const ratio = state.run.highestStageThisRun / this.config.rebirthUnlockStage;
    return big(Math.floor(Math.pow(ratio, KNOWLEDGE_STAGE_EXPONENT)));
  }

  /**
   * Paid on the margin, which needs no extra state because lifetime Knowledge
   * already *is* the high-water mark. Total Knowledge ever earned is therefore
   * exactly `floor((deepest rebirth stage / unlock stage) ^ exponent)`: going
   * deeper pays the difference, and going nowhere pays nothing.
   */
  previewKnowledgeGain(state: GameState) {
    const gain = this.knowledgeWorth(state).sub(state.meta.lifetimeKnowledge);
    // Returned rather than clamped with `max`, which hands back whichever zero
    // it was given - and a negative zero reaching the interface renders as "-0".
    return gain.cmp(0) > 0 ? gain : big(0);
  }

  /**
   * Deliberately the same question as "would this pay anything", so the button
   * and the action cannot disagree. Kept separate, a run that had not beaten its
   * own record would offer a Rebirth that then silently refused.
   */
  canRebirth(state: GameState): boolean {
    return this.previewKnowledgeGain(state).cmp(0) > 0;
  }

  /**
   * The frontier where the next point of Knowledge arrives, so the interface can
   * say what a disabled Rebirth is waiting for instead of only greying out.
   */
  nextKnowledgeStage(state: GameState): number {
    const target = state.meta.lifetimeKnowledge.add(1).toNumber();
    return Math.ceil(this.config.rebirthUnlockStage * Math.pow(target, 1 / KNOWLEDGE_STAGE_EXPONENT));
  }

  perform(state: GameState): boolean {
    const gain = this.previewKnowledgeGain(state);
    if (gain.cmp(0) <= 0) return false;

    const elapsed = state.run.elapsedSeconds;
    state.meta.knowledge = state.meta.knowledge.add(gain);
    // The balance is spendable and the high-water mark is not. Anything that
    // rewards how far an account has come has to read the second, or buying an
    // attunement would quietly cost the player whatever it rewards.
    state.meta.lifetimeKnowledge = state.meta.lifetimeKnowledge.add(gain);
    state.meta.rebirths += 1;
    state.run = createInitialRunState(this.config);

    // Equipment intentionally lives outside RunState, so gear power survives a
    // Rebirth rather than being wiped by it. The new run's maximum is computed
    // *after* Knowledge is banked above, so the fresh mage already stands on the
    // Mastery the Rebirth just bought - computing it first would start every run
    // one Rebirth behind.
    state.run.mage.maxHp = mageMaxHealth(state, this.config.baseMageHealth);
    state.run.mage.hp = big(state.run.mage.maxHp);

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
