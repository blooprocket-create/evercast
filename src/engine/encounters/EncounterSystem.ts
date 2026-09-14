import { requireEnemy, resolveZone } from '../../content/catalog';
import {
  BOSS_ATTACK_MULTIPLIER,
  BOSS_HEALTH_MULTIPLIER,
  WORLD_TIER_ATTACK,
  WORLD_TIER_HEALTH,
} from '../../content/zones';
import type { ContentCatalog } from '../../content/types';
import type { EngineConfig } from '../config';
import type { EncounterState, EnemyState, RunState } from '../model';
import { big } from '../numbers';
import { chooseDeterministic } from '../random/DeterministicRandom';
import { ensurePositions, laneZ, spawnPosition } from '../combat/SpellCombatState';
import { freeContactSlot } from '../combat/Contact';
import { hasLivingFrontline } from '../companions/Formation';

const LANES = [0, 1, 2, 3, 4, 5];

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
    // Captured once, here, and never recomputed. A wave that spawns while the
    // line is held keeps its distance for life; one that spawns after the tank
    // falls presses in toward the mage, which is what makes losing the front
    // row something you watch happen rather than read in a number.
    const frontlineOffset = hasLivingFrontline(run) ? this.config.frontlineStandoff : 0;
    const reach = (definition.attackRange ?? this.config.enemyAttackRange) + frontlineOffset;
    const stageExponent = Math.max(0, encounter.stage - 1);
    const bossHealthMultiplier = isBoss ? big(BOSS_HEALTH_MULTIPLIER) : big(1);
    const bossAttackMultiplier = isBoss ? big(BOSS_ATTACK_MULTIPLIER) : big(1);

    const maxHp = big(definition.baseHealth)
      .mul(big(definition.healthGrowth).pow(stageExponent))
      .mul(big(WORLD_TIER_HEALTH).pow(resolvedZone.worldTier))
      .mul(bossHealthMultiplier);
    const attackDamage = big(definition.baseAttack)
      .mul(big(definition.attackGrowth).pow(stageExponent))
      .mul(big(WORLD_TIER_ATTACK).pow(resolvedZone.worldTier))
      .mul(bossAttackMultiplier);

    const enemy: EnemyState = {
      instanceId: run.nextEnemyInstanceId++,
      definitionId: definition.id,
      name: isBoss
        ? `${definition.name} ${Math.max(1, Math.ceil(encounter.stage / this.config.bossCadence))}`
        : definition.name,
      stage: encounter.stage,
      boss: isBoss,
      hp: maxHp,
      maxHp,
      attackDamage,
      attackInterval: definition.attackInterval,
      attackCooldown: definition.attackInterval,
      // Resolved here rather than left undefined so a live enemy always carries
      // a concrete reach, and the fallback stays a pure legacy-save path.
      attackRange: definition.attackRange ?? this.config.enemyAttackRange,
      frontlineOffset,
      tags: [...definition.tags],
      // Claimed before the push, so the scan cannot see this enemy itself.
      contactSlot: freeContactSlot(run, reach, this.config.enemyAttackRange),
    };

    // Which lane it comes down is deterministic but unpredictable, so a wave
    // arrives spread across the road rather than in a single file.
    const lane = chooseDeterministic(
      LANES.slice(0, Math.max(1, this.config.laneCount)),
      this.config.seed,
      encounter.stage,
      spawnIndex,
      run.mode === 'push' ? 7 : 11,
    );
    // A boss walks in a little closer, so the fight starts sooner.
    const from = isBoss ? this.config.enemySpawnDistance * 0.72 : this.config.enemySpawnDistance;
    enemy.position = spawnPosition(lane, this.config.laneSpacing, from);
    enemy.approachFrom = from;
    enemy.approachFromZ = laneZ(lane, this.config.laneSpacing);
    enemy.approachSince = run.elapsedSeconds;

    run.enemies.push(enemy);
    ensurePositions(run, this.config.enemyAttackRange);
    encounter.spawnedEnemies += 1;
    encounter.spawnCooldown = encounter.spawnInterval;
    return enemy;
  }
}
