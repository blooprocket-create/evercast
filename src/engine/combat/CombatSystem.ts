import type { EngineConfig } from '../config';
import type { GameEvent } from '../events/GameEvent';
import { compileGearStats } from '../gear/GearSystem';
import type { EquipmentState } from '../gear/types';
import type { EnemyState, RunState } from '../model';
import { big } from '../numbers';
import { random01 } from '../random/DeterministicRandom';
import { resolveEffects } from '../spell/EffectResolver';
import { compileSpell } from '../spell/SpellCompiler';
import type { CompiledSpell } from '../spell/types';

export interface CombatResult {
  killedEnemyIds: number[];
  mageDefeated: boolean;
}

export class CombatSystem {
  constructor(
    private readonly config: EngineConfig,
    private readonly emit: (event: GameEvent) => void,
  ) {}

  cast(run: RunState, equipment: EquipmentState): CombatResult {
    const spell = compileSpell(run.spell);
    const gear = compileGearStats(equipment);
    const baseDamage = big(spell.damage).add(gear.baseDamageBonus).toString();
    const castId = run.stats.casts + 1;
    run.stats.casts = castId;
    this.emit({
      type: 'spell_cast',
      time: run.elapsedSeconds,
      castId,
      projectiles: spell.projectileCount,
    });

    for (let projectileIndex = 0; projectileIndex < spell.projectileCount; projectileIndex += 1) {
      const target = firstLivingEnemy(run);
      if (!target) break;
      this.hit(run, target, baseDamage, castId, projectileIndex, spell.critChance, spell.critMultiplier, true, 1, spell);

      const pierced = livingEnemiesExcluding(run, new Set([target.instanceId])).slice(0, spell.pierceTargets);
      for (const enemy of pierced) {
        this.hit(run, enemy, baseDamage, castId, projectileIndex, 0, spell.critMultiplier, false, 1, spell);
      }

      const chainExcluded = new Set([target.instanceId, ...pierced.map((enemy) => enemy.instanceId)]);
      const chained = livingEnemiesExcluding(run, chainExcluded).slice(0, spell.chainTargets);
      for (const enemy of chained) {
        this.hit(run, enemy, baseDamage, castId, projectileIndex, 0, spell.critMultiplier, false, spell.chainDamageMultiplier, spell);
      }

      const splashed = livingEnemiesExcluding(run, new Set([target.instanceId])).slice(0, spell.splashTargets);
      for (const enemy of splashed) {
        this.hit(run, enemy, baseDamage, castId, projectileIndex, 0, spell.critMultiplier, false, spell.splashDamageMultiplier, spell);
      }
    }

    return {
      killedEnemyIds: run.enemies.filter((enemy) => enemy.hp.cmp(0) <= 0).map((enemy) => enemy.instanceId),
      mageDefeated: false,
    };
  }

  enemyAttack(run: RunState, enemy: EnemyState): CombatResult {
    run.mage.hp = run.mage.hp.sub(enemy.attackDamage);
    this.emit({
      type: 'enemy_attack',
      time: run.elapsedSeconds,
      instanceId: enemy.instanceId,
      damage: enemy.attackDamage.toString(),
    });
    return {
      killedEnemyIds: [],
      mageDefeated: run.mage.hp.cmp(0) <= 0,
    };
  }

  private hit(
    run: RunState,
    enemy: EnemyState,
    baseDamage: string,
    castId: number,
    projectileIndex: number,
    critChance: number,
    critMultiplier: number,
    allowTriggers: boolean,
    damageMultiplier: number,
    spell: CompiledSpell,
  ): void {
    if (enemy.hp.cmp(0) <= 0 || damageMultiplier <= 0) return;

    const critical = critChance > 0 && random01(
      this.config.seed,
      run.encounterStage,
      castId,
      projectileIndex,
      enemy.instanceId,
      run.stats.projectileHits,
    ) < critChance;

    const hpBeforeHit = big(enemy.hp);
    let damage = big(baseDamage).mul(damageMultiplier);
    if (critical) damage = damage.mul(critMultiplier);
    const actualDamage = damage.cmp(hpBeforeHit) > 0 ? hpBeforeHit : damage;
    enemy.hp = decimalMaxZero(enemy.hp.sub(damage));
    run.stats.projectileHits += 1;
    if (critical) run.stats.criticalHits += 1;

    if (spell.controlDelaySeconds > 0 && enemy.hp.cmp(0) > 0) {
      enemy.attackCooldown += spell.controlDelaySeconds;
    }
    if (spell.leechFraction > 0 && actualDamage.cmp(0) > 0) {
      const healed = actualDamage.mul(spell.leechFraction);
      run.mage.hp = decimalMin(run.mage.maxHp, run.mage.hp.add(healed));
    }

    this.emit({
      type: 'projectile_hit',
      time: run.elapsedSeconds,
      castId,
      projectileIndex,
      instanceId: enemy.instanceId,
      damage: damage.toString(),
      critical,
    });

    if (!allowTriggers || enemy.hp.cmp(0) <= 0) return;
    const hitEffects = resolveEffects(spell, 'onHit', damage.toString());
    if (big(hitEffects.bonusDamage).cmp(0) > 0) {
      enemy.hp = decimalMaxZero(enemy.hp.sub(hitEffects.bonusDamage));
    }

    if (critical && enemy.hp.cmp(0) > 0) {
      const critEffects = resolveEffects(spell, 'onCrit', damage.toString());
      if (big(critEffects.bonusDamage).cmp(0) > 0) {
        enemy.hp = decimalMaxZero(enemy.hp.sub(critEffects.bonusDamage));
      }
      let repeatIndex = 10_000;
      for (const repeat of critEffects.repeatProjectiles) {
        for (let i = 0; i < repeat.count && enemy.hp.cmp(0) > 0; i += 1) {
          this.hit(
            run,
            enemy,
            baseDamage,
            castId,
            repeatIndex,
            0,
            critMultiplier,
            false,
            repeat.damageMultiplier,
            spell,
          );
          repeatIndex += 1;
        }
      }
    }
  }
}

function firstLivingEnemy(run: RunState): EnemyState | undefined {
  return run.enemies.find((enemy) => enemy.hp.cmp(0) > 0);
}

function livingEnemiesExcluding(run: RunState, excluded: ReadonlySet<number>): EnemyState[] {
  return run.enemies.filter((enemy) => enemy.hp.cmp(0) > 0 && !excluded.has(enemy.instanceId));
}

function decimalMaxZero(value: ReturnType<typeof big>) {
  return value.cmp(0) < 0 ? big(0) : value;
}

function decimalMin(max: ReturnType<typeof big>, value: ReturnType<typeof big>) {
  return value.cmp(max) > 0 ? big(max) : value;
}
