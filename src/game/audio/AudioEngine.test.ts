import { describe, expect, it } from 'vitest';
import { EvercastSimulation } from '../../engine/EvercastSimulation';
import { AudioEngine, previewStartAt, sceneMoodFor } from './AudioEngine';

const at = (phase: 'travel' | 'combat', alive: number, boss = false, zone = 1) =>
  sceneMoodFor({ zone, boss, phase, encounterAliveEnemies: alive });

describe('sceneMoodFor', () => {
  it('keeps travelling audible rather than silent', () => {
    expect(at('travel', 0).intensity).toBeGreaterThan(0);
  });

  it('lifts once a fight starts, and further for a crowd', () => {
    expect(at('combat', 1).intensity).toBeGreaterThan(at('travel', 0).intensity);
    expect(at('combat', 4).intensity).toBeGreaterThan(at('combat', 1).intensity);
  });

  it('winds down as a wave is cleared', () => {
    const full = at('combat', 5).intensity;
    const remnant = at('combat', 1).intensity;
    expect(remnant).toBeLessThan(full);
  });

  it('gives a boss the top of the range whatever else is happening', () => {
    expect(at('combat', 0, true).intensity).toBe(1);
    expect(at('travel', 0, true).intensity).toBe(1);
  });

  it('stays inside 0 and 1 for any crowd the engine can report', () => {
    for (const alive of [-3, 0, 1, 12, 500]) {
      const { intensity } = at('combat', alive);
      expect(intensity).toBeGreaterThanOrEqual(0);
      expect(intensity).toBeLessThanOrEqual(1);
    }
  });

  it('reads a real snapshot without needing a fixture', () => {
    // The engine is headless, so this is the actual shape the loop will pass.
    const simulation = new EvercastSimulation();
    simulation.update(1);
    const mood = sceneMoodFor(simulation.getSnapshot());
    expect(mood.zone).toBeGreaterThanOrEqual(1);
    expect(mood.intensity).toBeGreaterThan(0);
  });
});

describe('AudioEngine without a browser', () => {
  it('stays silent and inert instead of throwing', () => {
    const engine = new AudioEngine();
    engine.start();
    engine.setMix({ master: 1, music: 1, effects: 1, muted: false });
    engine.setScene(at('combat', 3));
    engine.handleEvents([{ type: 'spell_cast', time: 0, castId: 1, projectiles: 3 }]);
    engine.setSuspended(true);
    expect(engine.running).toBe(false);
    engine.dispose();
  });

  /**
   * The settings screen calls this on every slider release, so it runs long
   * before the first gesture has built a context. It has to answer rather than
   * throw: the screen shows its "this browser will not play sound" warning off
   * what this resolves with.
   */
  it('auditions nothing, and reports it, before there is a context', async () => {
    const engine = new AudioEngine();
    engine.setMix({ master: 1, music: 1, effects: 1, muted: false });

    await expect(engine.preview()).resolves.toBe(false);
    await expect(engine.preview('bossKill')).resolves.toBe(false);
    expect(engine.running).toBe(false);
  });

  it('auditions nothing while muted, without throwing', async () => {
    const engine = new AudioEngine();
    engine.setMix({ master: 1, music: 1, effects: 1, muted: true });
    await expect(engine.preview()).resolves.toBe(false);
  });
});

/**
 * `applyMix` ramps the bus gains rather than jumping them, so an audition fired
 * the instant a slider is released plays through whatever the gain happens to
 * be partway there. Dropping effects from 85% to zero and pressing test used to
 * land a hit at 61% of the old level on a slider reading zero.
 */
describe('previewStartAt', () => {
  it('waits for a gain ramp still in flight', () => {
    expect(previewStartAt(1, 1.2)).toBe(1.2);
  });

  it('does not wait once the gains have caught up', () => {
    expect(previewStartAt(2, 1.2)).toBeCloseTo(2.02);
  });

  it('always leads the clock, so a voice never starts in the past', () => {
    for (const [now, settled] of [[0, 0], [5, -1], [3, 3]]) {
      expect(previewStartAt(now, settled)).toBeGreaterThan(now);
    }
  });
});
