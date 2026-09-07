import type { EngineConfig } from '../config';
import type { GameEvent } from '../events/GameEvent';
import type { RunState } from '../model';
import { big } from '../numbers';
import { random01 } from '../random/DeterministicRandom';
import { resolveEffects } from '../spell/EffectResolver';
import { compileSpell } from '../spell/SpellCompiler';

export interface CombatResult {
  enemyKilled: boolean;
  mageDefeated: boolean;
}

export class CombatSystem {
  constructor(
    private readonly config: EngineConfig,
    private readonly emit: (event: GameEvent) => void,
  ) {}

  cast(run: RunState): CombatResult {
    const enemy = run.enemy;
    if (!enemy) return { enemyKilled: false, mageDefeated: false };
    const spell = compileSpell(run.spell);
    const castId = run.stats.casts + 1;
    run.stats.casts = castId;
    this.emit({
      type: 'spell_cast',
      time: run.elapsedSeconds,
      castId,
      projectiles: spell.projectileCount,
    });

    for (let projectileIndex = 0; projectileIndex < spell.projectileCount; projectileIndex += 1) {
      if (enemy.hp.cmp(0) <= 0) break;
      this.hit(run, spell.damage, castId, projectileIndex, spell.critChance, spell.critMultiplier, true);
    }

    return { enemyKilled: enemy.hp.cmp(0) <= 0, mageDefeated: false };
  }

  enemyAttack(run: RunState): CombatResult {
    const enemy = run.enemy;
    if (!enemy) return { enemyKilled: false, mageDefeated: false };
    run.mage.hp = run.mage.hp.sub(enemy.attackDamage);
    this.emit({
      type: 'enemy_attack',
      time: run.elapsedSeconds,
      damage: enemy.attackDamage.toString(),
    });
    return {
      enemyKilled: enemy.hp.cmp(0) <= 0,
      mageDefeated: run.mage.hp.cmp(0) <= 0,
    };
  }

  private hit(
    run: RunState,
    baseDamage: string,
    castId: number,
    projectileIndex: number,
    critChance: number,
    critMultiplier: number,
    allowTriggers: boolean,
    damageMultiplier = 1,
  ): void {
    const enemy = run.enemy;
    if (!enemy) return;

    const critical = random01(
      this.config.seed,
      run.encounterStage,
      castId,
      projectileIndex,
      run.stats.projectileHits,
    ) < critChance;

    let damage = big(baseDamage).mul(damageMultiplier);
    if (critical) damage = damage.mul(critMultiplier);
    enemy.hp = decimalMaxZero(enemy.hp.sub(damage));
    run.stats.projectileHits += 1;
    if (critical) run.stats.criticalHits += 1;

    this.emit({
      type: 'projectile_hit',
      time: run.elapsedSeconds,
      castId,
      projectileIndex,
      damage: damage.toString(),
      critical,
    });

    if (!allowTriggers || enemy.hp.cmp(0) <= 0) return;
    const spell = compileSpell(run.spell);
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
            baseDamage,
            castId,
            repeatIndex,
            0,
            critMultiplier,
            false,
            repeat.damageMultiplier,
          );
          repeatIndex += 1;
        }
      }
    }
  }
}

function decimalMaxZero(value: ReturnType<typeof big>) {
  return value.cmp(0) < 0 ? big(0) : value;
}
