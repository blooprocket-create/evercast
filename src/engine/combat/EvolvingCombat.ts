import type { EngineConfig } from '../config';
import type { GameEvent } from '../events/GameEvent';
import { compileGearStats } from '../gear/GearSystem';
import type { EquipmentState } from '../gear/types';
import type { EnemyState, RunState } from '../model';
import { big } from '../numbers';
import { compileSpell, routeDamageScale } from '../spell/SpellCompiler';
import type { SpellMechanics } from '../spell/SpellMechanics';
// prettier-ignore
import { combatState, ensurePositions, livingByDistance, nearby, positionOf } from './SpellCombatState';
import { TimedSpellEffects } from './TimedSpellEffects';

/** Resolves the three authored routes, in any combination. All targets and proc results are engine facts. */
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
      .mul(routeDamageScale(m));
    // Twin decides how many projectiles leave the staff; Piercing decides how
    // far each one carries. They are separate questions, so a blended build is
    // two projectiles that each penetrate, not a choice between the two.
    const anchors = m.twinCast ? [primary, living[1] ?? primary] : [primary];
    const chains = anchors.map((anchor) =>
      m.piercingCast ? this.penetrationTargets(run, anchor, m) : [anchor],
    );
    const longestHops = Math.max(...chains.map((chain) => chain.length - 1));
    if (m.piercingCast && chains.every((chain) => chain.length === 1)) state.nextCastHaste = true;
    // Ascendance is exactly this: the charge no longer lapses when the spell
    // moves on to whatever is closest now.
    if (!m.ascendance && state.superchargeTargetId !== primary.instanceId) state.supercharge = 0;
    state.superchargeTargetId = primary.instanceId;
    const stacks = m.supercharge ? state.supercharge : 0;
    const perfect = m.perfect && state.focus >= m.focusMax;
    const activeOverdrive = state.overdriveUntil > run.elapsedSeconds;
    const powerScale = m.chargedCast ? Math.min(2.5, 1.35 + stacks * 0.15) : 1;
    this.emit({
      type: 'spell_cast',
      time: run.elapsedSeconds,
      castId,
      projectiles: anchors.length,
      route: m.route,
      powerScale,
      overdrive: activeOverdrive,
      perfect,
    });
    const stored = state.velocityReady ? big(state.velocityStored) : big(0);
    const kinetic = m.kinetic && (!m.chain || m.terminalVoltage);
    if (m.terminalVelocity && activeOverdrive) {
      state.velocityStored = big(state.velocityStored)
        .add(base.mul(Math.min(m.forceCap, Math.max(1, longestHops) * m.forceGain)))
        .toString();
      this.emit({ type: 'combat_state', time: run.elapsedSeconds, state: 'velocity', stacks: 1 });
    }
    const primaryHpFraction = Math.max(0, Math.min(1, primary.hp.div(primary.maxHp).toNumber()));
    // Did this cast crit at all? A blended Charged build lands several hits, and
    // any one of them landing critical means the cast is not a non-crit.
    let castCritical = false;
    // Stored velocity is one carryover released by one cast, so a second
    // projectile's terminal hit must not be paid the same charge again.
    let storedPaid = false;
    // One counter across the whole cast: the proc RNG is a pure hash of it, so
    // two projectiles must never present the same index to the same channel.
    let hitIndex = 0;
    for (let projectile = 0; projectile < chains.length; projectile++) {
      const chain = chains[projectile];
      const hops = chain.length - 1;
      const force = Math.min(m.forceCap, hops * m.forceGain);
      for (let step = 0; step < chain.length; step++) {
        const index = hitIndex++;
        const enemy = chain[step];
        if (enemy.hp.cmp(0) <= 0) continue;
        const critical = perfect || this.effects.roll(run, spell.critChance, 11, castId, index);
        castCritical ||= critical;
        const hpFraction = Math.max(0, Math.min(1, enemy.hp.div(enemy.maxHp).toNumber()));
        let damage = big(base);
        if (m.chargedCast) {
          damage = damage.mul(1 + stacks * m.superchargeGain);
          if (m.execution && hpFraction <= m.executeThreshold)
            damage = damage.mul(1 + m.executeDamage);
          if (m.finalBlow)
            damage = damage.mul(
              1 +
                m.finalBlowPower * Math.pow(1 - hpFraction, m.finalBlowExponent) +
                (hpFraction <= m.criticalThreshold ? m.finalBlowLowBonus : 0),
            );
        }
        const terminal =
          m.piercingCast && step === chain.length - 1 && (kinetic || state.velocityReady);
        if (m.piercingCast && step > 0) damage = damage.mul(m.piercedDamage);
        if (m.driving && !m.kinetic) damage = damage.mul(1 + Math.min(m.forceCap, step * m.forceGain));
        if (terminal && !(m.terminalVelocity && activeOverdrive)) {
          // Force is gathered per chain, so each projectile pays its own. The
          // stored charge is not: it belongs to the cast.
          damage = damage.add(base.mul(force)).add(storedPaid ? 0 : stored);
          storedPaid = true;
        }
        if (critical)
          damage = damage.mul(
            (spell.critMultiplier + (m.ascendance ? state.focus * m.ascendanceCritGain : 0)) *
              (m.criticalOverload ? 1 + stacks * m.overloadCritGain : 1),
          );
        const actual = this.effects.damage(run, enemy, damage.toString());
        run.stats.projectileHits++;
        if (critical) run.stats.criticalHits++;
        this.emit({
          type: 'projectile_hit',
          time: run.elapsedSeconds,
          castId,
          projectileIndex: projectile,
          instanceId: enemy.instanceId,
          damage: actual,
          critical,
          source: m.piercingCast && step > 0 ? (m.chain ? 'chain' : 'pierce') : 'direct',
          sourceInstanceId: m.piercingCast && step > 0 ? chain[step - 1].instanceId : undefined,
          sequence: m.piercingCast ? step : 0,
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
        if (m.momentum && step > 0 && m.piercingCast && (!m.chain || m.stormdrive))
          this.gainMomentum(run, m);
        // Singularity: the force the terminal hit just delivered collapses. No
        // force gathered, nothing to collapse - so it pays for long chains.
        if (terminal && m.singularity && force > 0)
          this.effects.explosion(
            run,
            positionOf(enemy),
            enemy.instanceId,
            base.mul(force).toString(),
            { ...m, blastRadius: m.singularityRadius, explosionDamage: m.singularityDamage },
            castId,
          );
      }
    }
    if (state.velocityReady) {
      state.velocityStored = '0';
      state.velocityReady = false;
    }
    if (m.perfect) {
      if (perfect) state.focus = 0;
      else if (!castCritical)
        state.focus = Math.min(
          m.focusMax,
          state.focus + 1 + (m.deathSentence ? this.woundedGain(primaryHpFraction, m) : 0),
        );
      this.emit({ type: 'combat_state', time: run.elapsedSeconds, state: 'focus', stacks: state.focus });
    }
    if (m.supercharge) {
      state.supercharge =
        perfect && m.criticalOverload
          ? 0
          : Math.min(
              m.superchargeCap,
              state.supercharge + 1 + (m.obliteration ? this.woundedGain(primaryHpFraction, m) : 0),
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
