import { describe, expect, it, vi } from 'vitest';
import { SPELL_MECHANIC_DEFAULTS as defaults } from '../../content/spellTreeTuning';
import { DEFAULT_ENGINE_CONFIG } from '../config';
import type { GameEvent } from '../events/GameEvent';
import { big } from '../numbers';
import { createInitialGameState } from '../state';
import { compileSpell } from '../spell/SpellCompiler';
import type { SpellMechanics } from '../spell/SpellMechanics';
import { CombatSystem } from './CombatSystem';
import { combatState, effectiveCastInterval } from './SpellCombatState';

function fixture(
  mechanics: Partial<SpellMechanics> = {},
  positions = [
    { x: 2.4, z: 0 },
    { x: 3.6, z: 0 },
    { x: 4.8, z: 0 },
  ],
) {
  const state = createInitialGameState(DEFAULT_ENGINE_CONFIG),
    events: GameEvent[] = [];
  const m = { ...defaults, ...mechanics };
  state.run.spell = {
    baseDamage: '10',
    castInterval: 1,
    projectileCount: 1,
    critChance: 0,
    critMultiplier: 2,
    modifiers: [],
    mechanics: m,
  };
  state.run.enemies = positions.map((position, index) => ({
    instanceId: index + 1,
    definitionId: 'target',
    name: 'Target',
    stage: 1,
    boss: false,
    hp: big(10000),
    maxHp: big(10000),
    attackDamage: big(10),
    attackInterval: 1,
    attackCooldown: 1,
    position,
  }));
  state.run.mage.hp = big(10000);
  state.run.mage.maxHp = big(10000);
  const combat = new CombatSystem(DEFAULT_ENGINE_CONFIG, (event) => events.push(event));
  const cast = () => {
    events.length = 0;
    combat.cast(state.run, state.equipment);
    return events.filter((e) => e.type === 'projectile_hit');
  };
  const advance = (time: number) => {
    events.length = 0;
    state.run.elapsedSeconds = time;
    combat.evolving.effects.advance(state.run);
    return events;
  };
  return { state, run: state.run, events, m, combat, cast, advance, runtime: combatState(state.run) };
}
const one = [{ x: 2.4, z: 0 }];
describe('Twin Cast and timed effects', () => {
  it('hits two distinct targets or the same survivor twice, retaining separate explosions', () => {
    const f = fixture({ route: 'twin', explosive: true });
    expect(f.cast().map((h) => h.instanceId)).toEqual([1, 2]);
    expect(new Set(f.events.filter((e) => e.type === 'effect_hit').map((e) => e.effectId)).size).toBe(2);
    const single = fixture({ route: 'twin', explosive: true }, one);
    expect(single.cast().map((h) => h.instanceId)).toEqual([1, 1]);
    expect(single.events.filter((e) => e.type === 'effect_hit')).toHaveLength(2);
    expect(single.run.enemies[0].hp.toNumber()).toBeCloseTo(10000 - 20 - 7);
  });
  it('uses the authored 15% roll separately on valid hits and delays multiple meteors', () => {
    const f = fixture({ route: 'twin', meteor: true });
    const roll = vi
      .spyOn(f.combat.evolving.effects, 'roll')
      .mockImplementation((_run, chance) => chance === 0.15);
    f.cast();
    expect(roll.mock.calls.filter((c) => c[1] === 0.15)).toHaveLength(2);
    expect(f.runtime.meteors).toHaveLength(2);
    expect(f.events.filter((e) => e.type === 'effect_hit')).toHaveLength(0);
    f.advance(0.54);
    expect(f.runtime.meteors).toHaveLength(2);
    f.advance(0.55);
    expect(f.runtime.meteors).toHaveLength(0);
    expect(new Set(f.events.filter((e) => e.type === 'effect_hit').map((e) => e.effectId)).size).toBe(2);
  });
  it('is reproducible and rolls independently rather than sharing one cast result', () => {
    const a = fixture({ route: 'twin', meteor: true }),
      b = fixture({ route: 'twin', meteor: true });
    let singles = 0,
      total = 0;
    for (let i = 0; i < 300; i++) {
      a.cast();
      b.cast();
      const queued = a.events.filter((e) => e.type === 'meteor_queued');
      total += queued.length;
      if (queued.length === 1) singles++;
      expect(a.events).toEqual(b.events);
    }
    expect(singles).toBeGreaterThan(0);
    expect(total).toBeGreaterThan(50);
    expect(total).toBeLessThan(130);
    expect(a.runtime.meteors.length).toBe(total); // No presentation-derived pending-work cap.
  });
  it('rolls contagion on ticks and allows a spread infection to spread again nearby', () => {
    const f = fixture({ route: 'twin', dot: true, contagion: true }, [
      { x: 0, z: 0 },
      { x: 2, z: 0 },
      { x: 4, z: 0 },
      { x: 20, z: 0 },
    ]);
    const roll = vi.spyOn(f.combat.evolving.effects, 'roll').mockReturnValue(true);
    f.combat.evolving.effects.applyDot(f.run, f.run.enemies[0], '10', f.m, 1, 1);
    expect(roll).not.toHaveBeenCalled();
    f.advance(1);
    expect(roll.mock.calls[0][1]).toBe(0.15);
    expect(f.run.enemies[1].statuses?.dot).toBeDefined();
    expect(f.run.enemies[2].statuses?.dot).toBeUndefined();
    f.advance(2);
    expect(f.run.enemies[2].statuses?.dot).toBeDefined();
    expect(f.run.enemies[3].statuses?.dot).toBeUndefined();
    expect(
      f.events.some(
        (e) => e.type === 'status_applied' && e.instanceId === 3 && e.sourceInstanceId === 2 && e.spread,
      ),
    ).toBe(true);
  });
  it('caps Weakness at two, retains reduction under Ruin, amplifies incoming damage, and expires both', () => {
    const f = fixture({ route: 'twin', weakness: true, ruin: true }, one);
    vi.spyOn(f.combat.evolving.effects, 'roll').mockImplementation((_run, chance) => chance === 0.15);
    f.cast();
    const enemy = f.run.enemies[0];
    expect(enemy.statuses?.weakness?.stacks).toBe(2);
    expect(enemy.statuses?.ruin).toBeDefined();
    f.cast();
    expect(enemy.statuses?.weakness?.stacks).toBe(2);
    expect(f.events.filter((e) => e.type === 'projectile_hit').map((e) => Number(e.damage))).toEqual([
      13, 13,
    ]);
    f.combat.enemyAttack(f.run, enemy);
    expect(f.run.mage.hp.toNumber()).toBeCloseTo(9992.4);
    f.advance(3);
    expect(enemy.statuses?.ruin).toBeUndefined();
    expect(enemy.statuses?.weakness).toBeDefined();
    f.advance(4);
    expect(enemy.statuses?.weakness).toBeUndefined();
    f.combat.enemyAttack(f.run, enemy);
    expect(f.run.mage.hp.toNumber()).toBeCloseTo(9982.4);
  });
  it('Plaguefall queues exactly one meteor per actual spread and infects its AoE', () => {
    const f = fixture({ dot: true, contagion: true, plaguefall: true, contagionRadius: 1.3 }, [
      { x: 0, z: 0 },
      { x: 1.2, z: 0 },
      { x: 2.4, z: 0 },
    ]);
    const roll = vi.spyOn(f.combat.evolving.effects, 'roll').mockReturnValue(true);
    f.combat.evolving.effects.applyDot(f.run, f.run.enemies[0], '10', f.m, 1, 1);
    f.advance(1);
    expect(roll).toHaveBeenCalledTimes(1);
    expect(f.runtime.meteors).toHaveLength(1);
    expect(f.runtime.meteors[0].targetId).toBe(2);
    f.advance(1.55);
    expect(f.run.enemies.every((e) => e.statuses?.dot)).toBe(true);
    expect(f.events.filter((e) => e.type === 'effect_hit' && e.effect === 'meteor')).toHaveLength(3);
  });
  it('Doomfall consumes Ruin once to empower the whole meteor and apply Weakness', () => {
    const f = fixture({ doomfall: true }, [
      { x: 0, z: 0 },
      { x: 1, z: 0 },
    ]);
    f.combat.evolving.effects.applyRuin(f.run, f.run.enemies[0], f.m, 1);
    f.combat.evolving.effects.queueMeteor(f.run, f.run.enemies[0], '10', f.m, 1);
    f.advance(0.55);
    expect(f.run.enemies[0].statuses?.ruin).toBeUndefined();
    expect(f.events.filter((e) => e.type === 'effect_hit').map((e) => Number(e.damage))).toEqual([
      37.5, 37.5,
    ]);
    expect(f.run.enemies.every((e) => e.statuses?.weakness?.stacks === 1)).toBe(true);
  });
  it('Blight spreads stronger Weakness only from a Ruined source', () => {
    for (const ruined of [false, true]) {
      const f = fixture({ dot: true, contagion: true, blight: true });
      vi.spyOn(f.combat.evolving.effects, 'roll').mockReturnValue(true);
      f.combat.evolving.effects.applyDot(f.run, f.run.enemies[0], '10', f.m, 1, 1);
      if (ruined) f.combat.evolving.effects.applyRuin(f.run, f.run.enemies[0], f.m, 1);
      f.advance(1);
      expect(f.run.enemies[1].statuses?.weakness?.strength).toBeCloseTo(0.12 * (ruined ? 1.5 : 1));
    }
  });
});
describe('Piercing route', () => {
  it('requires a living enemy behind the primary in the line, otherwise halves the next interval', () => {
    const f = fixture({ route: 'piercing' }, [
      { x: 1, z: 0 }, // the nearest, so the primary
      { x: 3.6, z: 0 }, // behind it in the line
      { x: 2.4, z: 1 }, // nearer than that, but off the line
    ]);
    // Straight through the one it is lined up with, not the one that happens
    // to be closer.
    expect(f.cast().map((h) => h.instanceId)).toEqual([1, 2]);
    expect(effectiveCastInterval(f.run)).toBe(1);
    f.run.enemies[1].hp = big(0);
    expect(f.cast().map((h) => h.instanceId)).toEqual([1]);
    expect(effectiveCastInterval(f.run)).toBe(0.5);
    f.run.enemies[1].hp = big(10000);
    f.cast();
    expect(effectiveCastInterval(f.run)).toBe(1);
  });
  it('Chain Lightning replaces piercing and retains A → B → C provenance', () => {
    const f = fixture({ route: 'piercing', chain: true, penetrations: 2 }, [
      { x: 2, z: 0 },
      { x: 2, z: 2 },
      { x: 3, z: 3 },
    ]);
    const hits = f.cast();
    expect(hits.map((h) => h.source)).toEqual(['direct', 'chain', 'chain']);
    expect(hits.map((h) => h.sourceInstanceId)).toEqual([undefined, 1, 2]);
    expect(hits.map((h) => h.sequence)).toEqual([0, 1, 2]);
    expect(compileSpell(f.run.spell).pierceTargets).toBe(0);
  });
  it('Driving Force grows each successive hit and respects the scaling cap', () => {
    const f = fixture({ route: 'piercing', driving: true, penetrations: 2, forceCap: 0.4 });
    expect(f.cast().map((h) => Number(h.damage))).toEqual([10, 13, 14]);
  });
  it('Kinetic Collapse stores progressive force for the final target', () => {
    const f = fixture({ route: 'piercing', driving: true, kinetic: true, penetrations: 2 });
    const hits = f.cast();
    expect(hits.map((h) => Number(h.damage))).toEqual([10, 10, 16]);
    expect(hits.map((h) => h.terminal)).toEqual([false, false, true]);
  });
  it('Momentum caps at five, accelerates casting, expires; Overdrive resets only at its end', () => {
    const f = fixture({ route: 'piercing', momentum: true, penetrations: 2 });
    f.cast();
    expect(f.runtime.momentum).toBe(2);
    expect(effectiveCastInterval(f.run)).toBeCloseTo(1 / 1.12);
    f.cast();
    f.cast();
    expect(f.runtime.momentum).toBe(5);
    f.advance(3);
    expect(f.runtime.momentum).toBe(0);
    f.m.overdrive = true;
    f.cast();
    f.cast();
    f.cast();
    expect(f.runtime.overdriveUntil).toBe(5.5);
    expect(effectiveCastInterval(f.run)).toBeCloseTo(1 / 1.8);
    f.advance(5.49);
    expect(f.runtime.momentum).toBe(5);
    f.advance(5.5);
    expect(f.runtime.momentum).toBe(0);
    expect(f.runtime.overdriveUntil).toBe(0);
  });
  it('Terminal Voltage delivers chain-wide force to the final chained target', () => {
    const f = fixture({
      route: 'piercing',
      chain: true,
      driving: true,
      kinetic: true,
      terminalVoltage: true,
      penetrations: 2,
    });
    expect(f.cast().map((h) => Number(h.damage))).toEqual([10, 10, 16]);
    expect(f.events.filter((e) => e.type === 'projectile_hit').map((e) => e.sourceInstanceId)).toEqual([
      undefined,
      1,
      2,
    ]);
  });
  it('Stormdrive converts every successful chain hop into Momentum and triggers Overdrive', () => {
    const f = fixture({ route: 'piercing', chain: true, momentum: true, overdrive: true, penetrations: 2 });
    f.cast();
    expect(f.runtime.momentum).toBe(0);
    f.m.stormdrive = true;
    f.cast();
    f.cast();
    f.cast();
    expect(f.runtime.momentum).toBe(5);
    expect(f.runtime.overdriveUntil).toBe(2.5);
    f.advance(2.5);
    expect(f.runtime.momentum).toBe(0);
  });
  it('Terminal Velocity accumulates during Overdrive and pays out exactly once after it ends', () => {
    const f = fixture({
      route: 'piercing',
      driving: true,
      kinetic: true,
      momentum: true,
      overdrive: true,
      terminalVelocity: true,
      penetrations: 2,
    });
    f.runtime.overdriveUntil = 2;
    f.runtime.momentum = 5;
    expect(f.cast().map((h) => Number(h.damage))).toEqual([10, 10, 10]);
    f.cast();
    expect(Number(f.runtime.velocityStored)).toBe(12);
    f.advance(2);
    expect(f.runtime.velocityReady).toBe(true);
    expect(f.cast().map((h) => Number(h.damage))).toEqual([10, 10, 28]);
    expect(f.runtime.velocityStored).toBe('0');
    expect(f.cast().map((h) => Number(h.damage))).toEqual([10, 10, 16]);
  });
});
describe('Charged route', () => {
  it('is one slower, substantially heavier projectile', () => {
    const f = fixture({ route: 'charged' });
    expect(compileSpell(f.run.spell).castInterval).toBe(1.7);
    expect(f.cast().map((h) => Number(h.damage))).toEqual([30]);
  });
  it('Perfect Strike builds Focus on non-crits then guarantees and consumes the next crit', () => {
    const f = fixture({ route: 'charged', perfect: true }, one);
    for (let i = 1; i <= 3; i++) {
      expect(f.cast()[0].critical).toBe(false);
      expect(f.runtime.focus).toBe(i);
    }
    expect(f.cast()[0].critical).toBe(true);
    expect(f.runtime.focus).toBe(0);
  });
  it('Supercharge strengthens and enlarges NEXT same-target hits, caps, and resets on switch', () => {
    const f = fixture({ route: 'charged', supercharge: true });
    const first = f.cast()[0],
      second = f.cast()[0];
    expect(Number(second.damage)).toBeGreaterThan(Number(first.damage));
    expect(second.powerScale).toBeGreaterThan(first.powerScale!);
    for (let i = 0; i < 10; i++) f.cast();
    expect(f.runtime.supercharge).toBe(5);
    f.run.enemies.shift();
    expect(Number(f.cast()[0].damage)).toBe(30);
    expect(f.runtime.supercharge).toBe(1);
  });
  it('Final Blow follows missing HP and low-health thresholds without an instant kill', () => {
    const damages: number[] = [];
    for (const fraction of [1, 0.5, 0.2, 0.1]) {
      const f = fixture({ route: 'charged', execution: true, finalBlow: true }, one);
      f.run.enemies[0].hp = big(10000 * fraction);
      damages.push(Number(f.cast()[0].damage));
      expect(f.run.enemies[0].hp.cmp(0)).toBeGreaterThan(0);
    }
    expect(damages).toEqual([...damages].sort((a, b) => a - b));
    expect(new Set(damages).size).toBe(4);
  });
  it('Critical Overload adds critical amplification and consumes all Supercharge on Perfect Strike', () => {
    const f = fixture({ route: 'charged', perfect: true, supercharge: true, criticalOverload: true }, one);
    f.cast();
    f.cast();
    f.cast();
    const hit = f.cast()[0];
    expect(hit.critical).toBe(true);
    expect(Number(hit.damage)).toBeCloseTo(30 * (1 + 3 * 0.18) * 2 * (1 + 3 * 0.2));
    expect(f.runtime.focus).toBe(0);
    expect(f.runtime.supercharge).toBe(0);
  });
  it.each(['deathSentence', 'obliteration'] as const)(
    '%s accelerates its resource as target health falls',
    (flag) => {
      const gains = [];
      for (const fraction of [1, 0.4, 0.1]) {
        const f = fixture({ route: 'charged', perfect: true, supercharge: true, [flag]: true }, one);
        f.run.enemies[0].hp = big(10000 * fraction);
        f.cast();
        gains.push(flag === 'deathSentence' ? f.runtime.focus : f.runtime.supercharge);
      }
      expect(gains).toEqual([1, 2, 3]);
    },
  );
});

describe('Targeting', () => {
  it('answers the nearest enemy rather than the one that spawned first', () => {
    // Exactly what per-enemy reach creates: a caster that arrived first and
    // stopped a long way out, with a melee enemy that walked past it since.
    const f = fixture({}, [
      { x: 4.6, z: 0 },
      { x: 1.1, z: 0 },
    ]);
    expect(f.cast().map((h) => h.instanceId)).toEqual([2]);
  });

  it('measures distance across the road, not just along it', () => {
    // The flanker is further along the road but standing off to one side, so
    // it is the further of the two.
    const f = fixture({}, [
      { x: 1.2, z: 0 },
      { x: 1.15, z: -0.66 },
    ]);
    expect(f.cast().map((h) => h.instanceId)).toEqual([1]);
  });

  it('sends the twin route at the two nearest, in order', () => {
    const f = fixture({ route: 'twin' }, [
      { x: 4.6, z: 0 },
      { x: 2.2, z: 0 },
      { x: 1.1, z: 0 },
    ]);
    expect(f.cast().map((h) => h.instanceId)).toEqual([3, 2]);
  });

  it('breaks a tie on instance id, so the order is the same every run', () => {
    const f = fixture({ route: 'twin' }, [
      { x: 2, z: 0 },
      { x: 2, z: 0 },
    ]);
    expect(f.cast().map((h) => h.instanceId)).toEqual([1, 2]);
  });

  it('moves on to whatever is closest once the nearest dies', () => {
    const f = fixture({}, [
      { x: 3, z: 0 },
      { x: 1, z: 0 },
    ]);
    expect(f.cast().map((h) => h.instanceId)).toEqual([2]);
    f.run.enemies[1].hp = big(0);
    expect(f.cast().map((h) => h.instanceId)).toEqual([1]);
  });
});
