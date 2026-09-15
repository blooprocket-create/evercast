import type { EngineConfig } from '../config';
import type { GameEvent } from '../events/GameEvent';
import type { EnemyState, RunState } from '../model';
import { big } from '../numbers';
import { random01 } from '../random/DeterministicRandom';
import type { SpellMechanics } from '../spell/SpellMechanics';
import { combatState, nearby, positionOf, type CombatPosition } from './SpellCombatState';
import { staggerMultiplier } from './Surge';
const EPS = 1e-9;
type Emit = (event: GameEvent) => void;

/** Serializable delayed work, timed statuses and proc RNG. No presentation limits. */
export class TimedSpellEffects {
  constructor(
    private config: EngineConfig,
    private emit: Emit,
  ) {}
  roll(run: RunState, chance: number, channel: number, castId: number, source: number): boolean {
    return (
      random01(this.config.seed, run.encounterStage, castId, source, ++combatState(run).procSerial, channel) <
      chance
    );
  }
  damage(run: RunState, target: EnemyState, amount: string): string {
    const ruin = target.statuses?.ruin;
    const multiplier =
      (ruin && ruin.expiresAt > run.elapsedSeconds ? 1 + ruin.amplification : 1) *
      staggerMultiplier(run, target);
    const damage = big(amount).mul(multiplier),
      actual = damage.cmp(target.hp) > 0 ? big(target.hp) : damage;
    target.hp = target.hp.sub(actual);
    return actual.toString();
  }
  applyDot(
    run: RunState,
    target: EnemyState,
    baseDamage: string,
    m: SpellMechanics,
    castId: number,
    source: number,
    spread = false,
  ): void {
    if (target.hp.cmp(0) <= 0) return;
    const statuses = (target.statuses ??= {}),
      old = statuses.dot;
    const damage = big(baseDamage).mul(m.dotDamage);
    statuses.dot = {
      baseDamage,
      damage: damage.toString(),
      nextTickAt: old?.nextTickAt ?? run.elapsedSeconds + m.dotInterval,
      expiresAt: run.elapsedSeconds + m.dotDuration,
      castId,
      sourceInstanceId: source,
      mechanics: { ...m },
    };
    if (old && big(old.damage).cmp(damage) > 0) {
      statuses.dot.damage = old.damage;
      statuses.dot.baseDamage = old.baseDamage;
    }
    this.emit({
      type: 'status_applied',
      time: run.elapsedSeconds,
      instanceId: target.instanceId,
      sourceInstanceId: source,
      status: 'dot',
      stacks: 1,
      expiresAt: statuses.dot.expiresAt,
      spread,
    });
  }
  applyWeakness(run: RunState, target: EnemyState, m: SpellMechanics, source: number, strong = false): void {
    if (target.hp.cmp(0) <= 0) return;
    const statuses = (target.statuses ??= {}),
      old = statuses.weakness;
    const stacks = Math.min(m.weaknessCap, (old && old.expiresAt > run.elapsedSeconds ? old.stacks : 0) + 1);
    statuses.weakness = {
      stacks,
      strength: Math.max(
        old && old.expiresAt > run.elapsedSeconds ? old.strength : 0,
        m.weaknessStrength * (strong ? m.blightStrength : 1),
      ),
      expiresAt: run.elapsedSeconds + m.weaknessDuration,
    };
    this.emit({
      type: 'status_applied',
      time: run.elapsedSeconds,
      instanceId: target.instanceId,
      sourceInstanceId: source,
      status: 'weakness',
      stacks,
      expiresAt: statuses.weakness.expiresAt,
    });
  }
  applyRuin(run: RunState, target: EnemyState, m: SpellMechanics, source: number): void {
    if (target.hp.cmp(0) <= 0) return;
    const statuses = (target.statuses ??= {});
    statuses.ruin = { amplification: m.ruinAmplification, expiresAt: run.elapsedSeconds + m.ruinDuration };
    this.emit({
      type: 'status_applied',
      time: run.elapsedSeconds,
      instanceId: target.instanceId,
      sourceInstanceId: source,
      status: 'ruin',
      stacks: 1,
      expiresAt: statuses.ruin.expiresAt,
    });
  }
  queueMeteor(
    run: RunState,
    target: EnemyState,
    baseDamage: string,
    m: SpellMechanics,
    castId: number,
    infect = false,
  ): void {
    const state = combatState(run),
      id = ++state.procSerial,
      dueAt = run.elapsedSeconds + m.meteorDelay,
      position = { ...positionOf(target) };
    state.meteors.push({
      id,
      dueAt,
      position,
      targetId: target.instanceId,
      castId,
      damage: baseDamage,
      mechanics: { ...m },
      infect,
    });
    this.emit({
      type: 'meteor_queued',
      time: run.elapsedSeconds,
      effectId: id,
      castId,
      instanceId: target.instanceId,
      position,
      dueAt,
      infect,
    });
  }
  explosion(
    run: RunState,
    center: CombatPosition,
    source: number,
    baseDamage: string,
    m: SpellMechanics,
    castId: number,
  ): void {
    const id = ++combatState(run).procSerial;
    for (const target of nearby(run, center, m.blastRadius))
      this.effectHit(
        run,
        target,
        big(baseDamage).mul(m.explosionDamage).toString(),
        'explosion',
        source,
        castId,
        id,
        center,
      );
  }
  gainMomentum(run: RunState, m: SpellMechanics, stacks = 1): void {
    const state = combatState(run);
    if (state.overdriveUntil > run.elapsedSeconds) return;
    state.momentum = Math.min(m.momentumCap, state.momentum + stacks);
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
  /**
   * What the spell does about a death, and the one place that answers it.
   *
   * Called from `EncounterLoop.collectDeadEnemies`, which is where a corpse
   * becomes an engine fact no matter who made it - the spell, a companion, or
   * an infection ticking out - so a kill is a kill. It runs before the body is
   * cleared away, because the burst needs the position it died at, and it reads
   * the build as it stands rather than a snapshot: this is the spell answering
   * now, not a proc resolving late.
   *
   * Returns whatever it killed in turn. The caller feeds those back in, so a
   * burst that kills bursts again; that terminates because an enemy is only
   * ever collected once.
   */
  resolveKill(run: RunState, victim: EnemyState): number[] {
    const m = run.spell.mechanics;
    if (!m) return [];
    const killed: number[] = [];

    const dot = victim.statuses?.dot;
    if (m.necrosis && dot) {
      const state = combatState(run);
      const id = ++state.procSerial;
      const at = positionOf(victim);
      const burst = big(dot.damage).mul(m.necrosisDamage).toString();
      for (const target of nearby(run, at, m.necrosisRadius, new Set([victim.instanceId]))) {
        this.effectHit(run, target, burst, 'necrosis', victim.instanceId, dot.castId, id, at);
        // The infection outlives its host: it spreads with whatever strength
        // the original carried, not the build's current tuning.
        this.applyDot(run, target, dot.baseDamage, dot.mechanics, dot.castId, victim.instanceId, true);
        if (target.hp.cmp(0) <= 0) killed.push(target.instanceId);
      }
    }

    if (m.cascade) this.gainMomentum(run, m, Math.max(1, Math.floor(m.cascadeStacks)));

    if (m.reclamation) {
      const state = combatState(run);
      if (m.perfect) {
        state.focus = Math.min(m.focusMax, state.focus + Math.max(0, Math.floor(m.reclaimFocus)));
        this.emit({ type: 'combat_state', time: run.elapsedSeconds, state: 'focus', stacks: state.focus });
      }
      if (m.supercharge) {
        state.supercharge = Math.min(
          m.superchargeCap,
          state.supercharge + Math.max(0, Math.floor(m.reclaimCharge)),
        );
        this.emit({
          type: 'combat_state',
          time: run.elapsedSeconds,
          state: 'supercharge',
          stacks: state.supercharge,
        });
      }
    }

    return killed;
  }
  nextDelay(run: RunState): number {
    const s = combatState(run);
    let next = Infinity;
    for (const meteor of s.meteors) next = Math.min(next, meteor.dueAt);
    for (const e of run.enemies) {
      const statuses = e.statuses;
      if (!statuses) continue;
      if (statuses.dot) next = Math.min(next, statuses.dot.nextTickAt, statuses.dot.expiresAt);
      if (statuses.weakness) next = Math.min(next, statuses.weakness.expiresAt);
      if (statuses.ruin) next = Math.min(next, statuses.ruin.expiresAt);
    }
    if (s.overdriveUntil > 0) next = Math.min(next, s.overdriveUntil);
    else if (s.momentumUntil > 0) next = Math.min(next, s.momentumUntil);
    return Math.max(0, next - run.elapsedSeconds);
  }
  advance(run: RunState): number[] {
    const now = run.elapsedSeconds,
      s = combatState(run);
    if (s.overdriveUntil > 0 && s.overdriveUntil <= now + EPS) {
      s.overdriveUntil = 0;
      s.momentum = 0;
      s.momentumUntil = 0;
      s.velocityReady = big(s.velocityStored).cmp(0) > 0;
      this.emit({ type: 'combat_state', time: now, state: 'overdrive', stacks: 0 });
    }
    if (!s.overdriveUntil && s.momentumUntil > 0 && s.momentumUntil <= now + EPS) {
      s.momentum = 0;
      s.momentumUntil = 0;
      this.emit({ type: 'combat_state', time: now, state: 'momentum', stacks: 0 });
    }
    // Expired debuffs do not affect damage at their exact deadline.
    for (const enemy of run.enemies) {
      if (enemy.statuses?.weakness && enemy.statuses.weakness.expiresAt <= now + EPS)
        delete enemy.statuses.weakness;
      if (enemy.statuses?.ruin && enemy.statuses.ruin.expiresAt <= now + EPS) delete enemy.statuses.ruin;
    }
    const due = s.meteors.filter((m) => m.dueAt <= now + EPS);
    s.meteors = s.meteors.filter((m) => m.dueAt > now + EPS);
    for (const meteor of due) {
      const m = meteor.mechanics,
        targets = nearby(run, meteor.position, m.blastRadius);
      const ruined = m.doomfall
        ? targets.filter((e) => e.statuses?.ruin && e.statuses.ruin.expiresAt > now)
        : [];
      const empowered = ruined.length > 0;
      for (const enemy of ruined) delete enemy.statuses!.ruin;
      const damage = big(meteor.damage)
        .mul(m.meteorDamage)
        .mul(empowered ? m.doomfallMultiplier : 1)
        .toString();
      for (const target of targets) {
        this.effectHit(
          run,
          target,
          damage,
          'meteor',
          meteor.targetId,
          meteor.castId,
          meteor.id,
          meteor.position,
          empowered,
        );
        if (empowered) this.applyWeakness(run, target, m, meteor.targetId);
        if (meteor.infect) this.applyDot(run, target, meteor.damage, m, meteor.castId, meteor.targetId);
      }
    }
    for (const enemy of [...run.enemies]) {
      const dot = enemy.statuses?.dot;
      if (!dot || enemy.hp.cmp(0) <= 0) continue;
      if (dot.nextTickAt <= now + EPS && dot.nextTickAt <= dot.expiresAt + EPS) {
        dot.nextTickAt += dot.mechanics.dotInterval;
        const ruined = !!enemy.statuses?.ruin;
        this.effectHit(
          run,
          enemy,
          dot.damage,
          'dot',
          dot.sourceInstanceId,
          dot.castId,
          ++s.procSerial,
          positionOf(enemy),
        );
        const m = dot.mechanics;
        if (m.contagion && this.roll(run, m.contagionChance, 31, dot.castId, enemy.instanceId)) {
          const candidates = nearby(run, positionOf(enemy), m.contagionRadius, new Set([enemy.instanceId]));
          const uninfected = candidates.filter((e) => !e.statuses?.dot);
          // Contagion normally prefers one uninfected neighbour and otherwise
          // refreshes the nearest. Pandemic takes several at once, and still
          // falls back to a refresh when there is nothing new to infect.
          const spread = m.pandemic
            ? uninfected.length > 0
              ? uninfected.slice(0, Math.max(1, Math.floor(m.pandemicTargets)))
              : candidates.slice(0, 1)
            : [uninfected[0] ?? candidates[0]];
          for (const target of spread) {
            if (!target) continue;
            this.applyDot(run, target, dot.baseDamage, m, dot.castId, enemy.instanceId, true);
            if (m.blight) this.applyWeakness(run, target, m, enemy.instanceId, ruined);
            if (m.plaguefall) this.queueMeteor(run, target, dot.baseDamage, m, dot.castId, true);
          }
        }
      }
      if (dot.expiresAt <= now + EPS && enemy.statuses?.dot === dot) delete enemy.statuses.dot;
    }
    return run.enemies.filter((e) => e.hp.cmp(0) <= 0).map((e) => e.instanceId);
  }
  private effectHit(
    run: RunState,
    target: EnemyState,
    amount: string,
    effect: 'explosion' | 'meteor' | 'dot' | 'necrosis',
    source: number,
    castId: number,
    effectId: number,
    position: CombatPosition,
    empowered = false,
  ): void {
    if (target.hp.cmp(0) <= 0) return;
    const damage = this.damage(run, target, amount);
    this.emit({
      type: 'effect_hit',
      time: run.elapsedSeconds,
      effectId,
      castId,
      instanceId: target.instanceId,
      sourceInstanceId: source,
      damage,
      effect,
      position: { ...position },
      empowered,
    });
  }
}
