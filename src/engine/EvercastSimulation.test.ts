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

  describe('the last defeat', () => {
    it('is nothing until the mage falls', () => {
      expect(new EvercastSimulation().getSnapshot().lastDefeat).toBeNull();
    });

    it('names the enemy that landed the blow, and survives a catch-up', () => {
      /*
       * The interface used to work this out by watching the death counter and
       * naming whichever enemy was on screen the tick before it moved - which
       * a single `advance` of 900 seconds defeats entirely, because the whole
       * span is simulated before anything is published. This is the fact it
       * reads instead.
       */
      const sim = new EvercastSimulation({ config: { autoRetryFarmKills: 999 } });
      sim.advance(900, { presentationEvents: false });

      const defeat = sim.getSnapshot().lastDefeat;
      expect(defeat).not.toBeNull();
      expect(defeat!.enemyName.length).toBeGreaterThan(0);
      // An authored name, not an identifier: no snake_case, no camelCase.
      expect(defeat!.enemyName).not.toMatch(/_|\b[a-z]+[A-Z]/);
      expect(defeat!.stage).toBeGreaterThan(0);
    });

    it('counts up once per fall, so a reader can tell one from a re-render', () => {
      // The default config retries the frontier on its own, so a long enough
      // run falls more than once.
      const sim = new EvercastSimulation();
      sim.advance(900, { presentationEvents: false });
      const first = sim.getSnapshot().lastDefeat!;
      expect(first.serial).toBe(sim.getSnapshot().deaths);
      // Reading it again is not a new defeat.
      expect(sim.getSnapshot().lastDefeat!.serial).toBe(first.serial);

      sim.advance(2700, { presentationEvents: false });
      const later = sim.getSnapshot().lastDefeat!;
      expect(later.serial).toBeGreaterThan(first.serial);
      expect(later.serial).toBe(sim.getSnapshot().deaths);
    });
  });

  describe('story flags', () => {
    it('records a beat once and refuses it thereafter', () => {
      const sim = new EvercastSimulation();
      expect(sim.getSnapshot().storyFlags).toEqual([]);

      expect(sim.execute({ type: 'mark_story_flag', flag: 'premise_seen' })).toBe(true);
      expect(sim.getSnapshot().storyFlags).toEqual(['premise_seen']);

      // Idempotent, and the refusal matters: `runCommand` publishes and saves
      // on acceptance, so a re-dismissal that returned true would spend a write
      // on nothing.
      expect(sim.execute({ type: 'mark_story_flag', flag: 'premise_seen' })).toBe(false);
      expect(sim.getSnapshot().storyFlags).toEqual(['premise_seen']);
    });

    it('survives a Rebirth, because reading something is not run progress', () => {
      // Same shape prestige/RebirthSystem.test.ts uses: the unlock stage is
      // config, so the boundary can be reached in a test rather than waited for.
      const sim = new EvercastSimulation({ config: { rebirthUnlockStage: 2 } });
      sim.execute({ type: 'mark_story_flag', flag: 'premise_seen' });
      sim.advance(30, { presentationEvents: false });

      expect(sim.getSnapshot().canRebirth).toBe(true);
      expect(sim.execute({ type: 'rebirth' })).toBe(true);
      expect(sim.getSnapshot().rebirths).toBe(1);
      expect(sim.getSnapshot().storyFlags).toEqual(['premise_seen']);
    });
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
