import { describe, expect, it } from 'vitest';
import { EvercastSimulation } from './EvercastSimulation';
import { createDefaultSpellBuild } from './spell/SpellCompiler';
import { createDefaultCatalog } from '../content/catalog';

describe('EvercastSimulation', () => {
  it('preserves the active catalog model keys through the extracted snapshot builder', () => {
    const defaults = createDefaultCatalog();
    const catalog = {
      ...defaults,
      enemies: new Map([...defaults.enemies].map(([id, definition]) => [
        id, { ...definition, modelKey: `custom/${id}` },
      ])),
    };
    const sim = new EvercastSimulation({ catalog, config: { travelSeconds: 0.1 } });
    sim.advance(0.11, { presentationEvents: false });
    const enemies = sim.getSnapshot().enemies;
    expect(enemies.length).toBeGreaterThan(0);
    const states = sim.getState().run.enemies;
    for (const enemy of enemies) {
      const state = states.find((item) => item.instanceId === enemy.instanceId)!;
      expect(enemy.modelKey).toBe(`custom/${state.definitionId}`);
    }
  });

  it('advances without depending on a renderer', () => {
    const sim = new EvercastSimulation();
    sim.advance(120, { presentationEvents: false });
    const snapshot = sim.getSnapshot();
    expect(snapshot.elapsedSeconds).toBeGreaterThanOrEqual(119.9);
    expect(snapshot.stage).toBeGreaterThan(1);
    expect(snapshot.kills).toBeGreaterThan(0);
  });

  it('is deterministic for the same seed and commands', () => {
    const left = new EvercastSimulation({ config: { seed: 12345 } });
    const right = new EvercastSimulation({ config: { seed: 12345 } });
    left.advance(300, { presentationEvents: false });
    right.advance(300, { presentationEvents: false });
    expect(right.getSnapshot()).toEqual(left.getSnapshot());
  });

  it('supports replacing the spell build without coupling to UI', () => {
    const weak = new EvercastSimulation({ config: { seed: 77 } });
    const strong = new EvercastSimulation({ config: { seed: 77 } });
    const build = createDefaultSpellBuild();
    build.baseDamage = '50';
    build.projectileCount = 3;
    strong.execute({ type: 'set_spell_build', build });
    weak.advance(180, { presentationEvents: false });
    strong.advance(180, { presentationEvents: false });
    expect(strong.getSnapshot().stage).toBeGreaterThan(weak.getSnapshot().stage);
  });

  it('spawns later enemies on a timer even while earlier enemies remain alive', () => {
    const sim = new EvercastSimulation({
      config: {
        travelSeconds: 0.1,
        enemySpawnInterval: 0.2,
        baseMageHealth: 10_000,
      },
    });
    const build = createDefaultSpellBuild();
    build.baseDamage = '0.01';
    build.castInterval = 10;
    sim.execute({ type: 'set_spell_build', build });

    // Clear stage 1 very slowly is not useful for this test; jump the run to stage 3 before the encounter starts.
    sim.getState().run.frontierStage = 3;
    sim.getState().run.highestStageThisRun = 3;
    sim.advance(0.55, { presentationEvents: false });
    const snapshot = sim.getSnapshot();

    expect(snapshot.encounterTotalEnemies).toBe(3);
    expect(snapshot.encounterSpawnedEnemies).toBe(3);
    expect(snapshot.encounterAliveEnemies).toBe(3);
    expect(snapshot.enemies).toHaveLength(3);
  });

  it('falls back to farming when the frontier becomes lethal', () => {
    const sim = new EvercastSimulation({
      config: { autoRetryFarmKills: 999 },
    });
    sim.advance(900, { presentationEvents: false });
    const snapshot = sim.getSnapshot();
    expect(snapshot.deaths).toBeGreaterThan(0);
    expect(snapshot.mode).toBe('farm');
    expect(snapshot.farmStage).toBeLessThan(snapshot.stage);
  });

  describe('advance guard', () => {
    it('still stops a loop that has run away', () => {
      const sim = new EvercastSimulation({
        config: { maxAdvanceSteps: 8, maxAdvanceStepsPerSecond: 0 },
      });
      expect(() => sim.advance(3600)).toThrow(/safety limit exceeded/);
    });

    /**
     * The budget has to scale with the span, because the loop takes one step per
     * world event: a day of catch-up is legitimately hundreds of thousands of
     * steps, and a flat cap read that as a runaway and threw.
     */
    it('grows with the span being advanced, so a long span is not mistaken for one', () => {
      const perSecond = 4;
      const span = 3600;
      const generous = new EvercastSimulation({
        config: { maxAdvanceSteps: 0, maxAdvanceStepsPerSecond: span * perSecond },
      });
      expect(() => generous.advance(span, { presentationEvents: false })).not.toThrow();

      // The same density over the same span, with the budget no longer keeping up.
      const stingy = new EvercastSimulation({
        config: { maxAdvanceSteps: 0, maxAdvanceStepsPerSecond: 1 },
      });
      expect(() => stingy.advance(span, { presentationEvents: false })).toThrow(
        /safety limit exceeded/,
      );
    });

    it('leaves a single frame guarded by the floor', () => {
      const sim = new EvercastSimulation({
        config: { maxAdvanceSteps: 0, maxAdvanceStepsPerSecond: 1 },
      });
      // A frame is a fraction of a second, so the rate alone buys nothing: with
      // no floor even normal live play would trip the guard.
      expect(() => sim.update(1 / 60)).toThrow(/safety limit exceeded/);
      expect(() => new EvercastSimulation().update(1 / 60)).not.toThrow();
    });
  });
});
