import type Decimal from 'break_eternity.js';
import type { EngineConfig } from '../config';
import type { GameEvent, ProjectileHitSource } from '../events/GameEvent';
import { compileGearStats } from '../gear/GearSystem';
import type { EquipmentState } from '../gear/types';
import type { EnemyState, RunState } from '../model';
import { big } from '../numbers';
import { random01 } from '../random/DeterministicRandom';
import { resolveEffects } from '../spell/EffectResolver';
import { compileSpell } from '../spell/SpellCompiler';
import type { CompiledSpell } from '../spell/types';
import { damageCompanion, guardReduction } from '../companions/CompanionCombat';
import { chooseTarget } from './Threat';
import { EvolvingCombat } from './EvolvingCombat';
import { livingByDistance } from './SpellCombatState';
import { staggerMultiplier } from './Surge';

export interface CombatResult {
  killedEnemyIds: number[];
  mageDefeated: boolean;
}

export class CombatSystem {
  readonly evolving: EvolvingCombat;
  constructor(
    private readonly config: EngineConfig,
    private readonly emit: (event: GameEvent) => void,
  ) {
    this.evolving = new EvolvingCombat(config, emit);
  }

  cast(run: RunState, equipment: EquipmentState, mastery: Decimal): CombatResult {
    if (run.spell.mechanics)
      return { killedEnemyIds: this.evolving.cast(run, equipment, mastery), mageDefeated: false };
    const spell = compileSpell(run.spell);
    const gear = compileGearStats(equipment);
    const baseDamage = big(spell.damage).add(gear.baseDamageBonus).mul(mastery).toString();
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
      this.hit(
        run,
        target,
        baseDamage,
        castId,
        projectileIndex,
        spell.critChance,
        spell.critMultiplier,
        true,
        1,
        spell,
        'direct',
        undefined,
        0,
      );

      const pierced = livingEnemiesExcluding(run, new Set([target.instanceId])).slice(0, spell.pierceTargets);
      pierced.forEach((enemy, index) => {
        this.hit(
          run,
          enemy,
          baseDamage,
          castId,
          projectileIndex,
          0,
          spell.critMultiplier,
          false,
          1,
          spell,
          'pierce',
          target.instanceId,
          index + 1,
        );
      });

      const chainExcluded = new Set([target.instanceId, ...pierced.map((enemy) => enemy.instanceId)]);
      const chained = livingEnemiesExcluding(run, chainExcluded).slice(0, spell.chainTargets);
      let previousChainTargetId = target.instanceId;
      chained.forEach((enemy, index) => {
        this.hit(
          run,
          enemy,
          baseDamage,
          castId,
          projectileIndex,
          0,
          spell.critMultiplier,
          false,
          spell.chainDamageMultiplier,
          spell,
          'chain',
          previousChainTargetId,
          index + 1,
        );
        previousChainTargetId = enemy.instanceId;
      });

      const splashed = livingEnemiesExcluding(run, new Set([target.instanceId])).slice(
        0,
        spell.splashTargets,
      );
      splashed.forEach((enemy, index) => {
        this.hit(
          run,
          enemy,
          baseDamage,
          castId,
          projectileIndex,
          0,
          spell.critMultiplier,
          false,
          spell.splashDamageMultiplier,
          spell,
          'splash',
          target.instanceId,
          index + 1,
        );
      });
    }

    return {
      killedEnemyIds: run.enemies.filter((enemy) => enemy.hp.cmp(0) <= 0).map((enemy) => enemy.instanceId),
      mageDefeated: false,
    };
  }

  enemyAttack(run: RunState, enemy: EnemyState): CombatResult {
    const weakness = enemy.statuses?.weakness;
    const damage = enemy.attackDamage
      .mul(
        weakness && weakness.expiresAt > run.elapsedSeconds
          ? Math.max(0, 1 - weakness.stacks * weakness.strength)
          : 1,
      )
      // A guard shelters the whole party, the mage included.
      .mul(1 - guardReduction(run));

    // Who takes it is a pure function of the field, so a chunked run, a single
    // pass and a resumed save never disagree about where the blow landed.
    const target = chooseTarget(run, enemy);
    this.emit({
      type: 'enemy_attack',
      time: run.elapsedSeconds,
      instanceId: enemy.instanceId,
      damage: damage.toString(),
      targetSlot: target.kind === 'companion' ? target.companion.slot : undefined,
    });

    if (target.kind === 'companion') {
      damageCompanion(run, target.companion, damage, this.emit, enemy.instanceId);
      // A companion going down costs the rest of the fight, never the run.
      return { killedEnemyIds: [], mageDefeated: false };
    }

    run.mage.hp = run.mage.hp.sub(damage);
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
    source: ProjectileHitSource,
    sourceInstanceId: number | undefined,
    sequence: number,
  ): void {
    if (enemy.hp.cmp(0) <= 0 || damageMultiplier <= 0) return;

    const critical =
      critChance > 0 &&
      random01(
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
    // Folded in before the effect triggers below, which derive their bonus
    // damage from this figure - so a broken Surge amplifies what it sets off
    // as well as what lands, rather than only the first number.
    damage = damage.mul(staggerMultiplier(run, enemy));
    const actualDamage = damage.cmp(hpBeforeHit) > 0 ? hpBeforeHit : damage;
    enemy.hp = decimalMaxZero(enemy.hp.sub(damage));
    run.stats.projectileHits += 1;
    if (critical) run.stats.criticalHits += 1;

    const healthBeforeLeech = big(run.mage.hp);
    const controlDelaySeconds = enemy.hp.cmp(0) > 0 ? spell.controlDelaySeconds : 0;
    if (spell.controlDelaySeconds > 0 && enemy.hp.cmp(0) > 0) {
      enemy.attackCooldown += spell.controlDelaySeconds;
      // The swing it had already raised is no longer imminent, so let it
      // telegraph again rather than land the next one unannounced.
      enemy.telegraphed = false;
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
      damage: actualDamage.toString(),
      critical,
      source,
      sourceInstanceId,
      sequence,
      healing: decimalMaxZero(run.mage.hp.sub(healthBeforeLeech)).toString(),
      controlDelaySeconds,
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
            'repeat',
            enemy.instanceId,
            i + 1,
          );
          repeatIndex += 1;
        }
      }
    }
  }
}

function firstLivingEnemy(run: RunState): EnemyState | undefined {
  return livingByDistance(run)[0];
}

function livingEnemiesExcluding(run: RunState, excluded: ReadonlySet<number>): EnemyState[] {
  // Nearest first, so pierce, chain and splash spend themselves on the enemies
  // closest to the mage rather than on whatever spawned earliest.
  return livingByDistance(run, new Set(excluded));
}

function decimalMaxZero(value: ReturnType<typeof big>) {
  return value.cmp(0) < 0 ? big(0) : value;
}

function decimalMin(max: ReturnType<typeof big>, value: ReturnType<typeof big>) {
  return value.cmp(max) > 0 ? big(max) : value;
}
