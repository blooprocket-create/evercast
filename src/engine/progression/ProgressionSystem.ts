import type { EngineConfig } from '../config';
import type { GameEvent } from '../events/GameEvent';
import { goldRewardForKill } from '../gear/GearSystem';
import type { EnemyState, GameState } from '../model';
import { big } from '../numbers';
import { resolveEffects } from '../spell/EffectResolver';
import { compileSpell } from '../spell/SpellCompiler';

export class ProgressionSystem {
  constructor(
    private readonly config: EngineConfig,
    private readonly emit: (event: GameEvent) => void,
  ) {}

  handleEnemyKilled(state: GameState, enemy: EnemyState): void {
    const { run, meta, equipment } = state;
    const compiledSpell = compileSpell(run.spell);
    const killEffects = resolveEffects(compiledSpell, 'onKill');
    const reward = enemy.reward.mul(killEffects.essenceMultiplier).floor();
    const gold = goldRewardForKill(enemy.stage, enemy.boss);
    run.essence = run.essence.add(reward);
    equipment.gold = equipment.gold.add(gold);
    run.stats.kills += 1;
    if (enemy.boss) run.stats.bossKills += 1;
    meta.lifetimeKills += 1;
    if (run.mode === 'farm') run.farmKillsSinceFailure += 1;

    this.emit({
      type: 'enemy_killed',
      time: run.elapsedSeconds,
      stage: enemy.stage,
      instanceId: enemy.instanceId,
      enemyId: enemy.definitionId,
      reward: reward.toString(),
    });
    this.emit({
      type: 'resource_gained',
      time: run.elapsedSeconds,
      resource: 'essence',
      amount: reward.toString(),
    });
    this.emit({
      type: 'resource_gained',
      time: run.elapsedSeconds,
      resource: 'gold',
      amount: gold.toString(),
    });
  }

  handleEncounterCleared(state: GameState): void {
    const { run, meta } = state;
    if (run.mode === 'push') {
      run.frontierStage += 1;
      run.highestStageThisRun = Math.max(run.highestStageThisRun, run.frontierStage);
      meta.highestStageEver = Math.max(meta.highestStageEver, run.frontierStage);
      this.emit({
        type: 'stage_advanced',
        time: run.elapsedSeconds,
        stage: run.frontierStage,
      });
    } else if (run.farmKillsSinceFailure >= this.config.autoRetryFarmKills) {
      run.mode = 'push';
      run.farmKillsSinceFailure = 0;
      this.emit({
        type: 'mode_changed',
        time: run.elapsedSeconds,
        mode: 'push',
        reason: 'automatic frontier retry',
      });
    }
    this.resetAfterEncounter(run);
  }

  handleDefeat(state: GameState): void {
    const { run } = state;
    run.stats.deaths += 1;
    this.emit({
      type: 'mage_defeated',
      time: run.elapsedSeconds,
      stage: run.encounterStage,
    });

    if (run.mode === 'push') {
      run.mode = 'farm';
      run.farmKillsSinceFailure = 0;
      run.farmStage = this.safeFarmStage(run.frontierStage - 1);
      this.emit({
        type: 'mode_changed',
        time: run.elapsedSeconds,
        mode: 'farm',
        reason: 'frontier defeat',
      });
    } else {
      run.farmStage = this.safeFarmStage(run.farmStage - 1);
    }

    this.resetAfterEncounter(run);
  }

  retryFrontier(state: GameState): void {
    const { run } = state;
    if (run.mode === 'push') return;
    run.mode = 'push';
    run.farmKillsSinceFailure = 0;
    run.enemies = [];
    run.encounter = null;
    run.phase = 'travel';
    run.travelElapsed = 0;
    run.mage.hp = big(run.mage.maxHp);
    this.emit({
      type: 'mode_changed',
      time: run.elapsedSeconds,
      mode: 'push',
      reason: 'manual frontier retry',
    });
  }

  private safeFarmStage(stage: number): number {
    let result = Math.max(1, stage);
    if (result % this.config.bossCadence === 0 && result > 1) result -= 1;
    return result;
  }

  private resetAfterEncounter(run: GameState['run']): void {
    run.enemies = [];
    run.encounter = null;
    run.phase = 'travel';
    run.travelElapsed = 0;
    run.castCooldown = 0;
    run.mage.hp = big(run.mage.maxHp);
  }
}
