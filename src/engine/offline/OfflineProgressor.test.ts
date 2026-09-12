import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE_CONFIG } from '../config';
import { EvercastSimulation } from '../EvercastSimulation';
import { GEAR_SLOT_ORDER } from '../gear/GearCatalog';
import { big } from '../numbers';
import { SPELL_TREE_NODES } from '../spellTree/SpellTreeCatalog';
import { OFFLINE_SAMPLE_SECONDS, OfflineProgressor } from './OfflineProgressor';

/**
 * A save that has actually been played: gear levelled, the tree filled in as far
 * as Essence allows, and a party fielded. Event density is what made a long
 * catch-up expensive, and a fresh save has the least of it of any state in the
 * game - so the honest test of a day away is a day away from somewhere.
 */
function playedSimulation(seconds: number): EvercastSimulation {
  const simulation = new EvercastSimulation();
  for (let elapsed = 0; elapsed < seconds; elapsed += 60) {
    simulation.advance(60, { presentationEvents: false });
    for (const slot of GEAR_SLOT_ORDER) {
      while (simulation.execute({ type: 'level_gear', slot }));
    }
    while (simulation.execute({ type: 'buy_spell_point' }));
    for (const node of SPELL_TREE_NODES) {
      simulation.execute({ type: 'activate_spell_node', nodeId: node.id });
    }
    while (simulation.execute({ type: 'summon_draw', count: 1 }));
    const owned = Object.keys(simulation.getState().companions.owned);
    simulation.getState().companions.party.forEach((_, slot) => {
      const definitionId = owned[slot];
      if (definitionId) simulation.execute({ type: 'equip_companion', definitionId, slot });
    });
  }
  simulation.drainPresentationEvents();
  return simulation;
}

const DAY = DEFAULT_ENGINE_CONFIG.maxOfflineSeconds;

describe('OfflineProgressor', () => {
  it('uses the same deterministic simulation and suppresses presentation spam', () => {
    const sim = new EvercastSimulation();
    const summary = new OfflineProgressor(3600).apply(sim, 600);
    expect(summary.secondsApplied).toBe(600);
    expect(summary.kills).toBeGreaterThan(0);
    expect(sim.drainPresentationEvents()).toEqual([]);
  });

  it('caps offline time', () => {
    const sim = new EvercastSimulation();
    const summary = new OfflineProgressor(60).apply(sim, 600);
    expect(summary.secondsApplied).toBe(60);
  });

  it('credits nothing for no time away', () => {
    const sim = new EvercastSimulation();
    for (const seconds of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const before = sim.getSnapshot();
      const summary = new OfflineProgressor(DAY).apply(sim, seconds);
      expect(summary.secondsApplied).toBe(0);
      expect(summary.kills).toBe(0);
      expect(sim.getSnapshot().gold.raw).toBe(before.gold.raw);
    }
  });

  describe('an absence within the sample window', () => {
    it('is simulated outright rather than estimated', () => {
      const estimated = new EvercastSimulation();
      const summary = new OfflineProgressor(DAY).apply(estimated, OFFLINE_SAMPLE_SECONDS);
      expect(summary.secondsSimulated).toBe(OFFLINE_SAMPLE_SECONDS);
      expect(summary.secondsApplied).toBe(OFFLINE_SAMPLE_SECONDS);

      // Identical to simply advancing the simulation across the same span.
      const exact = new EvercastSimulation();
      exact.advance(OFFLINE_SAMPLE_SECONDS, { presentationEvents: false });
      expect(estimated.getSnapshot().gold.raw).toBe(exact.getSnapshot().gold.raw);
      expect(estimated.getSnapshot().kills).toBe(exact.getSnapshot().kills);
      expect(estimated.getSnapshot().stage).toBe(exact.getSnapshot().stage);
    });
  });

  describe('an absence past the sample window', () => {
    /**
     * The regression the whole change exists for. A day away used to be applied
     * event by event out of a module imported on the way to the first render: at
     * stage 19 that is 345,000 world events, it blew the advance guard, and the
     * throw came up as a blank page on every reload.
     */
    it('settles a day away from a played save, quickly and without throwing', () => {
      const simulation = playedSimulation(10 * 60);
      expect(simulation.getSnapshot().stage).toBeGreaterThan(1);

      const started = performance.now();
      const summary = new OfflineProgressor(DAY).apply(simulation, DAY);
      const elapsedMs = performance.now() - started;

      expect(summary.secondsApplied).toBe(DAY);
      expect(summary.secondsSimulated).toBe(OFFLINE_SAMPLE_SECONDS);
      expect(summary.kills).toBeGreaterThan(0);
      // Bounded by the sample, not by the absence. Exact catch-up took ~12s here.
      expect(elapsedMs).toBeLessThan(2000);
    }, 60_000);

    it('costs no more for a week away than for a day', () => {
      const day = playedSimulation(10 * 60);
      let started = performance.now();
      const dayAway = new OfflineProgressor(DAY).apply(day, DAY);
      const dayMs = performance.now() - started;

      const week = playedSimulation(10 * 60);
      started = performance.now();
      const weekAway = new OfflineProgressor(DAY).apply(week, 7 * DAY);
      const weekMs = performance.now() - started;

      // Both cap to a day and both simulate one sample, so neither the work nor
      // the reward may run away with the length of the absence.
      expect(weekAway.secondsApplied).toBe(dayAway.secondsApplied);
      expect(weekMs).toBeLessThan(Math.max(dayMs, 200) * 3);
    }, 60_000);

    it('scales the repeatable rewards by the time it did not simulate', () => {
      const sample = new EvercastSimulation();
      const sampleOnly = new OfflineProgressor(DAY).apply(sample, OFFLINE_SAMPLE_SECONDS);

      const full = new EvercastSimulation();
      const scaled = new OfflineProgressor(DAY).apply(full, 4 * OFFLINE_SAMPLE_SECONDS);

      // Four sample windows of absence, so about four samples' worth of yield.
      const ratio = big(scaled.goldGained.raw).div(big(sampleOnly.goldGained.raw)).toNumber();
      expect(ratio).toBeGreaterThan(3.5);
      expect(ratio).toBeLessThan(4.5);
      expect(scaled.kills).toBeGreaterThan(sampleOnly.kills * 3);
      expect(scaled.secondsApplied).toBe(4 * OFFLINE_SAMPLE_SECONDS);
    });

    it('credits Starlight on the same rate as Gold', () => {
      const sim = new EvercastSimulation();
      const before = sim.getSnapshot().starlight.raw;
      new OfflineProgressor(DAY).apply(sim, DAY);
      expect(big(sim.getSnapshot().starlight.raw).cmp(before)).toBeGreaterThan(0);
    });

    /**
     * Essence is a first-clear reward and the stage is the record of where the run
     * actually reached. `totalFirstClearEssenceEarned` treats the highest stage as
     * the authority on Essence ever earned, so inventing either would put a save
     * at odds with its own economy.
     */
    it('never invents Essence or stage progress beyond what it simulated', () => {
      const sampleRun = playedSimulation(10 * 60);
      const sampleOnly = new OfflineProgressor(DAY).apply(sampleRun, OFFLINE_SAMPLE_SECONDS);

      const simulation = playedSimulation(10 * 60);
      const before = simulation.getSnapshot();
      const dayAway = new OfflineProgressor(DAY).apply(simulation, DAY);
      const after = simulation.getSnapshot();

      // A day away credits no more of either than its own ten-minute sample did.
      expect(
        big(dayAway.essenceGained.raw).cmp(big(sampleOnly.essenceGained.raw)),
      ).toBeLessThanOrEqual(0);
      expect(after.stage - before.stage).toBeLessThanOrEqual(
        sampleOnly.stageAfter - sampleOnly.stageBefore,
      );
      expect(after.highestStageEver).toBe(Math.max(before.highestStageEver, after.stage));
    }, 60_000);
  });

  describe('the summary it reports', () => {
    it('counts the away time it settled, not the sample it used', () => {
      const simulation = playedSimulation(5 * 60);
      const summary = new OfflineProgressor(DAY).apply(simulation, DAY);
      expect(summary.secondsApplied).toBe(DAY);
      expect(summary.secondsSimulated).toBe(OFFLINE_SAMPLE_SECONDS);
      expect(summary.secondsSimulated).toBeLessThan(summary.secondsApplied);
    }, 60_000);

    it('is settled once, so later live play cannot change it', () => {
      const simulation = new EvercastSimulation();
      const summary = new OfflineProgressor(DAY).apply(simulation, DAY);
      const reported = { kills: summary.kills, gold: summary.goldGained.raw };

      for (let frame = 0; frame < 600; frame += 1) simulation.update(1 / 60);
      simulation.drainPresentationEvents();

      expect(summary.kills).toBe(reported.kills);
      expect(summary.goldGained.raw).toBe(reported.gold);
    });

    it('reports a gain the player can spend, never a loss', () => {
      const simulation = playedSimulation(5 * 60);
      const summary = new OfflineProgressor(DAY).apply(simulation, DAY);
      expect(big(summary.goldGained.raw).cmp(0)).toBeGreaterThan(0);
      expect(summary.kills).toBeGreaterThan(0);
      expect(summary.stageAfter).toBeGreaterThanOrEqual(summary.stageBefore);
    }, 60_000);
  });
});
