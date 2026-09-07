import type { ContentCatalog } from '../../content/types';
import { requireEnemy, resolveZone } from '../../content/catalog';
import type { EngineConfig } from '../config';
import type { EnemyState, RunState } from '../model';
import { big } from '../numbers';
import { chooseDeterministic } from '../random/DeterministicRandom';

export interface EncounterDescriptor {
  enemy: EnemyState;
  zoneNumber: number;
  zoneName: string;
}

export class EncounterSystem {
  constructor(
    private readonly catalog: ContentCatalog,
    private readonly config: EngineConfig,
  ) {}

  createForRun(run: RunState): EncounterDescriptor {
    const stage = run.mode === 'push' ? run.frontierStage : run.farmStage;
    const resolvedZone = resolveZone(this.catalog, stage, this.config.zoneLength);
    const isBoss = run.mode === 'push' && stage % this.config.bossCadence === 0;
    const enemyId = isBoss
      ? resolvedZone.zone.bossEnemyId
      : chooseDeterministic(
          resolvedZone.zone.enemyIds,
          this.config.seed,
          stage,
          run.stats.kills,
          run.mode === 'push' ? 1 : 2,
        );
    const definition = requireEnemy(this.catalog, enemyId);
    const stageExponent = Math.max(0, stage - 1);
    const worldTierMultiplier = big(1.75).pow(resolvedZone.worldTier);
    const bossHealthMultiplier = isBoss ? big(4.5) : big(1);
    const bossAttackMultiplier = isBoss ? big(1.8) : big(1);
    const bossRewardMultiplier = isBoss ? big(5) : big(1);

    const maxHp = big(definition.baseHealth)
      .mul(big(definition.healthGrowth).pow(stageExponent))
      .mul(worldTierMultiplier)
      .mul(bossHealthMultiplier);

    const attackDamage = big(definition.baseAttack)
      .mul(big(definition.attackGrowth).pow(stageExponent))
      .mul(big(1.35).pow(resolvedZone.worldTier))
      .mul(bossAttackMultiplier);

    const reward = big(definition.rewardBase)
      .mul(big(definition.rewardGrowth).pow(stageExponent))
      .mul(big(1.5).pow(resolvedZone.worldTier))
      .mul(bossRewardMultiplier)
      .floor();

    return {
      zoneNumber: resolvedZone.zoneNumber,
      zoneName: resolvedZone.zone.name,
      enemy: {
        definitionId: definition.id,
        name: isBoss ? `${definition.name} ${Math.max(1, Math.ceil(stage / this.config.bossCadence))}` : definition.name,
        stage,
        boss: isBoss,
        hp: maxHp,
        maxHp,
        attackDamage,
        attackInterval: definition.attackInterval,
        attackCooldown: definition.attackInterval,
        reward: reward.cmp(1) < 0 ? big(1) : reward,
      },
    };
  }
}
