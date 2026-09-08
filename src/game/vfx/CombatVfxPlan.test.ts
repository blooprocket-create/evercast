import { describe, expect, it } from 'vitest';
import { castDuration, planCast, type Hit } from './CombatVfxPlan';
const hit = (
  source: Hit['source'],
  instanceId: number,
  sourceInstanceId?: number,
  sequence = 0,
  projectileIndex = 0,
): Hit => ({
  type: 'projectile_hit',
  time: 0,
  castId: 1,
  projectileIndex,
  instanceId,
  damage: '5',
  critical: false,
  source,
  sourceInstanceId,
  sequence,
});

describe('authoritative combat presentation routes', () => {
  it('keeps one projectile through the ordered pierce targets even when all sources refer to the original target', () => {
    const plan = planCast([hit('direct', 10), hit('pierce', 30, 10, 2), hit('pierce', 20, 10, 1)], 1);
    expect(plan.flights).toHaveLength(1);
    expect(plan.flights[0].hits.map((h) => h.hit.instanceId)).toEqual([10, 20, 30]);
    expect(plan.flights[0].hits.map((h) => h.fromId)).toEqual([undefined, 10, 20]);
  });
  it('honors chain A → B → C and does not turn splash into projectiles', () => {
    const plan = planCast(
      [hit('direct', 10), hit('chain', 20, 10, 1), hit('chain', 30, 20, 2), hit('splash', 40, 10, 1)],
      1,
    );
    expect(plan.flights).toHaveLength(1);
    expect(plan.impacts.map((h) => [h.fromId, h.hit.instanceId])).toEqual([
      [undefined, 10],
      [10, 20],
      [10, 40],
      [20, 30],
    ]);
    expect(plan.impacts.find((h) => h.hit.instanceId === 30)!.at).toBeGreaterThan(
      plan.impacts.find((h) => h.hit.instanceId === 20)!.at,
    );
  });
  it('separates echoes and projectile lanes and adapts release to cadence', () => {
    const plan = planCast(
      [hit('direct', 10), hit('direct', 20, undefined, 0, 1), hit('repeat', 10, 10, 1, 10000)],
      0.1,
    );
    expect(new Set(plan.flights.map((f) => f.lane)).size).toBe(3);
    expect(plan.flights.map((f) => f.echo)).toEqual([false, false, true]);
    expect(plan.flights[2].release).toBeGreaterThan(plan.flights[0].release);
    expect(plan.flights[0].release).toBeCloseTo(castDuration(0.1) * 0.5);
  });
  it('retains absent-source facts without manufacturing a direct hit', () => {
    const plan = planCast([hit('chain', 7, 6, 2), hit('splash', 8, 6, 1)], 0.01);
    expect(plan.flights).toEqual([]);
    expect(plan.impacts.every((h) => h.fromId === 6)).toBe(true);
  });
});
