import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../engine/events/GameEvent';
import { MAX_CLIMAX_HIT_STOP, MAX_HIT_STOP, planImpact } from './ImpactPlan';

const hit = (critical = false): GameEvent => ({
  type: 'projectile_hit',
  time: 0,
  castId: 1,
  projectileIndex: 0,
  instanceId: 1,
  damage: '10',
  critical,
  source: 'direct',
  sequence: 1,
});

const killed = (instanceId: number): GameEvent => ({
  type: 'enemy_killed',
  time: 0,
  stage: 1,
  instanceId,
  enemyId: 'moss_slime',
  gold: '5',
});

const effect = (kind: 'explosion' | 'meteor' | 'dot'): GameEvent => ({
  type: 'effect_hit',
  time: 0,
  effectId: 1,
  castId: 1,
  instanceId: 1,
  sourceInstanceId: 0,
  damage: '20',
  effect: kind,
  position: { x: 3, z: 0 },
});

describe('planImpact', () => {
  it('does nothing when nothing happened', () => {
    expect(planImpact([])).toEqual({ trauma: 0, hitStop: 0, flash: 0, climax: false });
  });

  it('makes a crit hit harder than a hit in all three channels', () => {
    const plain = planImpact([hit()]);
    const crit = planImpact([hit(true)]);
    expect(crit.trauma).toBeGreaterThan(plain.trauma);
    expect(crit.flash).toBeGreaterThan(plain.flash);
    expect(crit.hitStop).toBeGreaterThan(plain.hitStop);
  });

  it('never freezes an ordinary hit', () => {
    expect(planImpact([hit()]).hitStop).toBe(0);
  });

  it('leaves damage-over-time ticks alone', () => {
    // They fire on a timer; shaking the camera for one would never stop.
    expect(planImpact([effect('dot'), effect('dot')])).toEqual({
      trauma: 0,
      hitStop: 0,
      flash: 0,
      climax: false,
    });
  });

  it('holds a wave of hits under the ordinary freeze ceiling', () => {
    const wave = Array.from({ length: 40 }, (_, i) => hit(i % 3 === 0));
    expect(planImpact(wave).hitStop).toBeLessThanOrEqual(MAX_HIT_STOP);
  });

  it('lets a boss falling hold longer than combat ever does', () => {
    const boss = planImpact([killed(7)], (id) => id === 7);
    expect(boss.hitStop).toBeGreaterThan(MAX_HIT_STOP);
    expect(boss.hitStop).toBeLessThanOrEqual(MAX_CLIMAX_HIT_STOP);
    expect(boss.trauma).toBeGreaterThan(planImpact([killed(7)]).trauma);
  });

  it('never exceeds the climax ceiling, whatever lands at once', () => {
    const everything: GameEvent[] = [
      ...Array.from({ length: 30 }, () => hit(true)),
      ...Array.from({ length: 10 }, () => effect('meteor')),
      killed(1),
      killed(2),
      { type: 'mage_defeated', time: 0, stage: 4, enemyId: 'ash_beetle', enemyName: 'Ash Beetle' },
      { type: 'rebirth_performed', time: 0, knowledgeGained: '10', rebirths: 1 },
    ];
    const impact = planImpact(everything, () => true);
    expect(impact.hitStop).toBeLessThanOrEqual(MAX_CLIMAX_HIT_STOP);
    expect(impact.trauma).toBeLessThanOrEqual(1);
    expect(impact.flash).toBeLessThanOrEqual(1);
  });

  it('always adds, and never quite reaches the top', () => {
    // Saturating rather than summing is what stops a big wave pinning every
    // channel at maximum and flattening the difference between hits.
    let previous = 0;
    for (const count of [1, 2, 4, 8, 16]) {
      const { trauma } = planImpact(Array.from({ length: count }, () => hit()));
      expect(trauma).toBeGreaterThan(previous);
      expect(trauma).toBeLessThan(1);
      previous = trauma;
    }
  });

  it('ranks the spell effects by how big they look', () => {
    expect(planImpact([effect('meteor')]).trauma).toBeGreaterThan(
      planImpact([effect('explosion')]).trauma,
    );
  });

  it('shakes for the threshold states and not the per-cast counters', () => {
    const state = (s: 'overdrive' | 'momentum') =>
      planImpact([{ type: 'combat_state', time: 0, state: s, stacks: 2 }]);
    expect(state('overdrive').flash).toBeGreaterThan(0);
    expect(state('momentum')).toEqual({ trauma: 0, hitStop: 0, flash: 0, climax: false });
  });

  it('marks only the climaxes, so ordinary combat never goes slow motion', () => {
    const wave = Array.from({ length: 30 }, () => hit(true));
    expect(planImpact(wave).climax).toBe(false);
    expect(planImpact([...wave, killed(7)], (id) => id === 7).climax).toBe(true);
    expect(planImpact([{ type: 'mage_defeated', time: 0, stage: 4, enemyId: 'ash_beetle', enemyName: 'Ash Beetle' }]).climax).toBe(true);
  });

  it('flashes for a perfectly timed cast without freezing it', () => {
    const perfect = planImpact([{ type: 'spell_cast', time: 0, castId: 1, projectiles: 2, perfect: true }]);
    expect(perfect.flash).toBeGreaterThan(0);
    expect(perfect.hitStop).toBe(0);
  });
});
