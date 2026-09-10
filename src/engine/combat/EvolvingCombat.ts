import type { EngineConfig } from '../config';
import type { GameEvent } from '../events/GameEvent';
import { compileGearStats } from '../gear/GearSystem';
import type { EquipmentState } from '../gear/types';
import type { EnemyState, RunState } from '../model';
import { big } from '../numbers';
import { compileSpell } from '../spell/SpellCompiler';
import type { SpellMechanics } from '../spell/SpellMechanics';
// prettier-ignore
import { combatState, ensurePositions, livingByDistance, nearby, positionOf } from './SpellCombatState';
import { TimedSpellEffects } from './TimedSpellEffects';

/** Resolves the three authored routes. All targets and proc results are engine facts. */
export class EvolvingCombat {
  readonly effects: TimedSpellEffects;
  constructor(
    private readonly config: EngineConfig,
    private emit: (event: GameEvent) => void,
  ) {
    this.effects = new TimedSpellEffects(config, emit);
  }
  cast(run: RunState, equipment: EquipmentState): number[] {
    ensurePositions(run, this.config.enemyAttackRange);
    const spell = compileSpell(run.spell),
      m = spell.mechanics!,
      state = combatState(run);
    // Nearest first, so the spell answers whatever is closest to the mage and
    // the twin route's second bolt takes the one behind it.
    const living = livingByDistance(run),
      primary = living[0];
    if (!primary) return [];
    state.nextCastHaste = false;
    const castId = ++run.stats.casts;
    const base = big(spell.damage)
      .add(compileGearStats(equipment).baseDamageBonus)
      .mul(m.route === 'charged' ? m.chargedDamage : 1);
    const targets =
      m.route === 'twin'
        ? [primary, living[1] ?? primary]
        : m.route === 'piercing'
          ? this.penetrationTargets(run, primary, m)
          : [primary];
    const hops = targets.length - 1;
    if (m.route === 'piercing' && hops === 0) state.nextCastHaste = true;
    if (state.superchargeTargetId !== primary.instanceId) {
      state.supercharge = 0;
      state.superchargeTargetId = primary.instanceId;
    }
    const stacks = m.supercharge ? state.supercharge : 0;
    const perfect = m.perfect && state.focus >= m.focusMax;
    const activeOverdrive = state.overdriveUntil > run.elapsedSeconds;
    const powerScale = m.route === 'charged' ? Math.min(2.5, 1.35 + stacks * 0.15) : 1;
    this.emit({
      type: 'spell_cast',
      time: run.elapsedSeconds,
      castId,
      projectiles: m.route === 'twin' ? 2 : 1,
      route: m.route,
      powerScale,
      overdrive: activeOverdrive,
      perfect,
    });
    const stored = state.velocityReady ? big(state.velocityStored) : big(0);
    const kinetic = m.kinetic && (!m.chain || m.terminalVoltage);
    const force = Math.min(m.forceCap, hops * m.forceGain);
    if (m.terminalVelocity && activeOverdrive) {
      state.velocityStored = big(state.velocityStored)
        .add(base.mul(Math.min(m.forceCap, Math.max(1, hops) * m.forceGain)))
        .toString();
      this.emit({ type: 'combat_state', time: run.elapsedSeconds, state: 'velocity', stacks: 1 });
    }
    const hpFraction = Math.max(0, Math.min(1, primary.hp.div(primary.maxHp).toNumber()));
    let chargedCritical = false;
    for (let index = 0; index < targets.length; index++) {
      const enemy = targets[index];
      if (enemy.hp.cmp(0) <= 0) continue;
      const critical = perfect || this.effects.roll(run, spell.critChance, 11, castId, index);
      if (index === 0) chargedCritical = critical;
      let damage = big(base);
      if (m.route === 'charged') {
        damage = damage.mul(1 + stacks * m.superchargeGain);
        if (m.execution && hpFraction <= m.executeThreshold) damage = damage.mul(1 + m.executeDamage);
        if (m.finalBlow)
          damage = damage.mul(
            1 +
              m.finalBlowPower * Math.pow(1 - hpFraction, m.finalBlowExponent) +
              (hpFraction <= m.criticalThreshold ? m.finalBlowLowBonus : 0),
          );
      }
      const terminal =
        m.route === 'piercing' && index === targets.length - 1 && (kinetic || state.velocityReady);
      if (m.route === 'piercing' && index > 0) damage = damage.mul(m.piercedDamage);
      if (m.driving && !m.kinetic) damage = damage.mul(1 + Math.min(m.forceCap, index * m.forceGain));
      if (terminal && !(m.terminalVelocity && activeOverdrive))
        damage = damage.add(base.mul(force)).add(stored);
      if (critical)
        damage = damage.mul(
          spell.critMultiplier * (m.criticalOverload ? 1 + stacks * m.overloadCritGain : 1),
        );
      const actual = this.effects.damage(run, enemy, damage.toString());
      run.stats.projectileHits++;
      if (critical) run.stats.criticalHits++;
      this.emit({
        type: 'projectile_hit',
        time: run.elapsedSeconds,
        castId,
        projectileIndex: m.route === 'twin' ? index : 0,
        instanceId: enemy.instanceId,
        damage: actual,
        critical,
        source: m.route === 'piercing' && index > 0 ? (m.chain ? 'chain' : 'pierce') : 'direct',
        sourceInstanceId: m.route === 'piercing' && index > 0 ? targets[index - 1].instanceId : undefined,
        sequence: m.route === 'piercing' ? index : 0,
        powerScale,
        terminal,
      });
      if (m.dot) this.effects.applyDot(run, enemy, base.toString(), m, castId, enemy.instanceId);
      if (m.weakness) this.effects.applyWeakness(run, enemy, m, enemy.instanceId);
      if (m.ruin && this.effects.roll(run, m.ruinChance, 21, castId, index))
        this.effects.applyRuin(run, enemy, m, enemy.instanceId);
      if (m.explosive)
        this.effects.explosion(run, positionOf(enemy), enemy.instanceId, base.toString(), m, castId);
      if (m.meteor && this.effects.roll(run, m.meteorChance, 22, castId, index))
        this.effects.queueMeteor(run, enemy, base.toString(), m, castId);
      if (m.momentum && index > 0 && m.route === 'piercing' && (!m.chain || m.stormdrive))
        this.gainMomentum(run, m);
    }
    if (state.velocityReady) {
      state.velocityStored = '0';
      state.velocityReady = false;
    }
    if (m.perfect) {
      if (perfect) state.focus = 0;
      else if (!chargedCritical)
        state.focus = Math.min(
          m.focusMax,
          state.focus + 1 + (m.deathSentence ? this.woundedGain(hpFraction, m) : 0),
        );
      this.emit({ type: 'combat_state', time: run.elapsedSeconds, state: 'focus', stacks: state.focus });
    }
    if (m.supercharge) {
      state.supercharge =
        perfect && m.criticalOverload
          ? 0
          : Math.min(
              m.superchargeCap,
              state.supercharge + 1 + (m.obliteration ? this.woundedGain(hpFraction, m) : 0),
            );
      this.emit({
        type: 'combat_state',
        time: run.elapsedSeconds,
        state: 'supercharge',
        stacks: state.supercharge,
      });
    }
    return run.enemies.filter((e) => e.hp.cmp(0) <= 0).map((e) => e.instanceId);
  }
  private penetrationTargets(run: RunState, first: EnemyState, m: SpellMechanics): EnemyState[] {
    const targets = [first],
      visited = new Set([first.instanceId]);
    let previous = first;
    for (let index = 0; index < m.penetrations; index++) {
      const p = positionOf(previous);
      const candidates = m.chain
        ? nearby(run, p, m.chainRadius, visited)
        : run.enemies
            .filter(
              (e) =>
                e.hp.cmp(0) > 0 &&
                !visited.has(e.instanceId) &&
                positionOf(e).x > p.x &&
                Math.abs(positionOf(e).z - p.z) <= m.lineTolerance,
            )
            .sort((a, b) => positionOf(a).x - positionOf(b).x || a.instanceId - b.instanceId);
      const next = candidates[0];
      if (!next) break;
      targets.push(next);
      visited.add(next.instanceId);
      previous = next;
    }
    return targets;
  }
  private gainMomentum(run: RunState, m: SpellMechanics): void {
    const state = combatState(run);
    if (state.overdriveUntil > run.elapsedSeconds) return;
    state.momentum = Math.min(m.momentumCap, state.momentum + 1);
    state.momentumUntil = run.elapsedSeconds + m.momentumDuration;
    this.emit({
      type: 'combat_state',
      time: run.elapsedSeconds,
      state: 'momentum',
      stacks: state.momentum,
      expiresAt: state.momentumUntil,
    });
    if (m.overdrive && state.momentum >= m.momentumCap) {
      state.overdriveUntil = run.elapsedSeconds + m.overdriveDuration;
      this.emit({
        type: 'combat_state',
        time: run.elapsedSeconds,
        state: 'overdrive',
        stacks: state.momentum,
        expiresAt: state.overdriveUntil,
      });
    }
  }
  private woundedGain(hpFraction: number, m: SpellMechanics): number {
    return Number(hpFraction <= m.woundedThreshold) + Number(hpFraction <= m.criticalThreshold);
  }
}
