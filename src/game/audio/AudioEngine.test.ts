import { describe, expect, it } from 'vitest';
import { EvercastSimulation } from '../../engine/EvercastSimulation';
import { AudioEngine, sceneMoodFor } from './AudioEngine';

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
});
