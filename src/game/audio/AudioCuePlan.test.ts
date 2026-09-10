import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../engine/events/GameEvent';
import { AUDIO_BUDGET, planAudio } from './AudioCuePlan';

const hit = (instanceId: number, critical = false): GameEvent => ({
  type: 'projectile_hit',
  time: 0,
  castId: 1,
  projectileIndex: 0,
  instanceId,
  damage: '10',
  critical,
  source: 'direct',
  sequence: instanceId,
});

const attack = (instanceId: number): GameEvent => ({
  type: 'enemy_attack',
  time: 0,
  instanceId,
  damage: '3',
});

const killed = (instanceId = 1): GameEvent => ({
  type: 'enemy_killed',
  time: 0,
  instanceId,
  enemyId: 'moss_slime',
  stage: 1,
  gold: '5',
});

const spawned = (instanceId: number, boss: boolean): GameEvent => ({
  type: 'enemy_spawned',
  time: 0,
  stage: 1,
  instanceId,
  enemyId: boss ? 'road_warden' : 'moss_slime',
  enemyName: boss ? 'Road Warden' : 'Moss Slime',
  boss,
  spawned: 1,
  total: 3,
});

const effect = (effectId: number, kind: 'explosion' | 'meteor' | 'dot'): GameEvent => ({
  type: 'effect_hit',
  time: 0,
  effectId,
  castId: 1,
  instanceId: 1,
  sourceInstanceId: 0,
  damage: '25',
  effect: kind,
  position: { x: 3, z: 1.35 },
});

const voices = (events: GameEvent[], isBoss?: (id: number) => boolean) =>
  planAudio(events, isBoss).map((cue) => cue.voice);

describe('planAudio', () => {
  it('plays one cast however many projectiles it threw', () => {
    const events = [
      { type: 'spell_cast', time: 0, castId: 1, projectiles: 6 } as GameEvent,
      ...Array.from({ length: 6 }, (_, i) => hit(i + 1)),
    ];
    expect(voices(events).filter((v) => v === 'cast')).toHaveLength(1);
  });

  it('caps impacts rather than firing one per hit', () => {
    const events = Array.from({ length: 40 }, (_, i) => hit(i + 1));
    const impacts = planAudio(events).filter((cue) => cue.voice === 'impact');
    expect(impacts.length).toBeLessThanOrEqual(AUDIO_BUDGET.impacts);
    expect(impacts.length).toBeGreaterThan(0);
  });

  it('keeps the crit when it has to drop something', () => {
    const events = [...Array.from({ length: 30 }, (_, i) => hit(i + 1)), hit(99, true)];
    expect(voices(events)).toContain('crit');
  });

  it('ducks a crowd so twenty hits are not twenty times as loud', () => {
    const one = planAudio([hit(1)]).find((cue) => cue.voice === 'impact')!;
    const many = planAudio(Array.from({ length: 20 }, (_, i) => hit(i + 1)))
      .filter((cue) => cue.voice === 'impact')
      .reduce((sum, cue) => sum + cue.gain, 0);
    // Louder than a single hit, but nowhere near four times it.
    expect(many).toBeGreaterThan(one.gain);
    expect(many).toBeLessThan(one.gain * 4);
  });

  it('staggers impacts instead of stacking them on one instant', () => {
    const times = planAudio(Array.from({ length: 4 }, (_, i) => hit(i + 1)))
      .filter((cue) => cue.voice === 'impact')
      .map((cue) => cue.at);
    expect(new Set(times).size).toBe(times.length);
  });

  it('plays one death sound for a cleared wave', () => {
    const events = Array.from({ length: 6 }, (_, i) => killed(i + 1));
    expect(voices(events).filter((v) => v === 'kill')).toHaveLength(1);
  });

  it('lets a boss death outrank the ordinary one', () => {
    const sounds = voices([killed(4), killed(7)], (id) => id === 7);
    expect(sounds).toContain('bossKill');
    expect(sounds).not.toContain('kill');
  });

  it('does not mistake a boss stage add for the boss', () => {
    // A boss encounter spawns adds alongside it; only instance 7 is the boss.
    expect(voices([spawned(7, true), spawned(8, false), killed(8)], (id) => id === 7)).toContain(
      'kill',
    );
  });

  it('caps enemy attacks', () => {
    const attacks = planAudio(Array.from({ length: 9 }, (_, i) => attack(i + 1)));
    expect(attacks.filter((cue) => cue.voice === 'enemyAttack').length).toBeLessThanOrEqual(
      AUDIO_BUDGET.enemyAttacks,
    );
  });

  it('never exceeds the batch budget, even for an offline catch-up', () => {
    const events: GameEvent[] = [];
    for (let i = 0; i < 500; i += 1) {
      events.push(hit(i, i % 5 === 0), attack(i), killed(i));
    }
    expect(planAudio(events).length).toBeLessThanOrEqual(AUDIO_BUDGET.cues);
  });

  it('is quiet when nothing happened', () => {
    expect(planAudio([])).toEqual([]);
  });

  it('keeps gains inside a sane range', () => {
    const cues = planAudio([
      ...Array.from({ length: 12 }, (_, i) => hit(i + 1, i % 3 === 0)),
      killed(3),
      { type: 'mage_defeated', time: 0, stage: 4 } as GameEvent,
    ], (id) => id === 3);
    for (const cue of cues) {
      expect(cue.gain).toBeGreaterThan(0);
      expect(cue.gain).toBeLessThanOrEqual(1);
    }
  });

  it('gives spell effects a voice of their own', () => {
    expect(voices([effect(1, 'explosion')])).toContain('blast');
    expect(voices([effect(2, 'meteor')])).toContain('meteor');
  });

  it('leaves damage-over-time ticks silent', () => {
    // They fire on a timer whatever the player does; a voice would be a
    // metronome, and the effect is already on screen.
    expect(planAudio([effect(3, 'dot'), effect(4, 'dot')])).toEqual([]);
  });

  it('keeps the meteor when the effect budget is full of explosions', () => {
    const events = [...Array.from({ length: 9 }, (_, i) => effect(i + 1, 'explosion')), effect(99, 'meteor')];
    const heard = voices(events);
    expect(heard).toContain('meteor');
    expect(heard.filter((v) => v === 'blast' || v === 'meteor').length).toBeLessThanOrEqual(
      AUDIO_BUDGET.effectHits,
    );
  });

  it('rings out a perfectly timed cast on top of the cast itself', () => {
    const plain = voices([{ type: 'spell_cast', time: 0, castId: 1, projectiles: 2 }]);
    const timed = voices([{ type: 'spell_cast', time: 0, castId: 1, projectiles: 2, perfect: true }]);
    expect(plain).not.toContain('perfect');
    expect(timed).toContain('perfect');
    expect(timed).toContain('cast');
  });

  it('announces the threshold states and ignores the per-cast counters', () => {
    const surge = (state: 'overdrive' | 'velocity' | 'momentum' | 'focus' | 'supercharge') =>
      voices([{ type: 'combat_state', time: 0, state, stacks: 3 }]);
    expect(surge('overdrive')).toEqual(['surge']);
    expect(surge('velocity')).toEqual(['surge']);
    // These tick once per cast, so sounding them would only double the cast.
    expect(surge('momentum')).toEqual([]);
    expect(surge('focus')).toEqual([]);
    expect(surge('supercharge')).toEqual([]);
  });

  it('surges once however many states turned over at once', () => {
    const events: GameEvent[] = [
      { type: 'combat_state', time: 0, state: 'overdrive', stacks: 1 },
      { type: 'combat_state', time: 0, state: 'velocity', stacks: 1 },
    ];
    expect(voices(events).filter((v) => v === 'surge')).toHaveLength(1);
  });

  it('marks the moments worth hearing over combat', () => {
    expect(voices([{ type: 'spell_node_activated', time: 0, nodeId: 'a', nodeName: 'A' }])).toEqual([
      'awaken',
    ]);
    expect(voices([{ type: 'stage_advanced', time: 0, stage: 5 } as GameEvent])).toEqual(['advance']);
  });
});
