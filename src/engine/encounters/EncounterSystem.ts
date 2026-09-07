import type { ContentCatalog } from '../../content/types';
import { requireEnemy, resolveZone } from '../../content/catalog';
import type { EngineConfig } from '../config';
import type { EncounterState, EnemyState, RunState } from '../model';
import { big } from '../numbers';
import { chooseDeterministic } from '../random/DeterministicRandom';

export interface EncounterDescriptor {
  encounter: EncounterState;
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
    const bossStage = run.mode === 'push' && stage % this.config.bossCadence === 0;
    const localStage = ((stage - 1) % this.config.bossCadence) + 1;
    const totalEnemies = bossStage
      ? 1 + this.config.bossAddCount
      : Math.max(1, Math.min(this.config.maxNormalWaveEnemies, localStage));

    return {
      zoneNumber: resolvedZone.zoneNumber,
      zoneName: resolvedZone.zone.name,
      encounter: {
        stage,
        totalEnemies,
        spawnedEnemies: 0,
        spawnInterval: this.config.enemySpawnInterval,
        spawnCooldown: 0,
        maxAlive: this.config.maxAliveEnemies,
        bossStage,
      },
    };
  }

  spawnEnemy(run: RunState): EnemyState | null {
    const encounter = run.encounter;
    if (!encounter) return null;
    if (encounter.spawnedEnemies >= encounter.totalEnemies) return null;
    if (run.enemies.length >= encounter.maxAlive) return null;

    const resolvedZone = resolveZone(this.catalog, encounter.stage, this.config.zoneLength);
    const spawnIndex = encounter.spawnedEnemies;
    const isBoss = encounter.bossStage && spawnIndex === 0;
    const enemyId = isBoss
      ? resolvedZone.zone.bossEnemyId
      : chooseDeterministic(
          resolvedZone.zone.enemyIds,
          this.config.seed,
          encounter.stage,
          spawnIndex,
          run.mode === 'push' ? 1 : 2,
        );
    const definition = requireEnemy(this.catalog, enemyId);
    const stageExponent = Math.max(0, encounter.stage - 1);
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

    const enemy: EnemyState = {
      instanceId: run.nextEnemyInstanceId++,
      definitionId: definition.id,
      name: isBoss ? `${definition.name} ${Math.max(1, Math.ceil(encounter.stage / this.config.bossCadence))}` : definition.name,
      stage: encounter.stage,
      boss: isBoss,
      hp: maxHp,
      maxHp,
      attackDamage,
      attackInterval: definition.attackInterval,
      attackCooldown: definition.attackInterval,
      reward: reward.cmp(1) < 0 ? big(1) : reward,
    };

    run.enemies.push(enemy);
    encounter.spawnedEnemies += 1;
    encounter.spawnCooldown = encounter.spawnInterval;
    return enemy;
  }
}
