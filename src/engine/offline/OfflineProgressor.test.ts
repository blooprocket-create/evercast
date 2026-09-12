import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE_CONFIG } from '../config';
import { EvercastSimulation } from '../EvercastSimulation';
import { GEAR_SLOT_ORDER } from '../gear/GearCatalog';
import { SPELL_TREE_NODES } from '../spellTree/SpellTreeCatalog';
import { OfflineProgressor } from './OfflineProgressor';

/**
 * A save that has actually been played: gear levelled, the tree filled in as far
 * as Essence allows, and a party fielded. Event density is what makes catch-up
 * expensive, and a fresh save has the least of it of any state in the game - so
 * the honest test of a day away is a day away from somewhere.
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

  /**
   * The regression this file exists for. A day away from a played save is north
   * of a third of a million world events, and the advance guard used to be a
   * flat 250,000 - so the catch-up threw, out of a module imported on the way to
   * the first render, and the game came up as a blank page on every reload.
   */
  it('applies a full day away from a played save without tripping the advance guard', () => {
    const simulation = playedSimulation(10 * 60);
    const stageBefore = simulation.getSnapshot().stage;
    expect(stageBefore).toBeGreaterThan(1);

    const progressor = new OfflineProgressor(DEFAULT_ENGINE_CONFIG.maxOfflineSeconds);
    const summary = progressor.apply(simulation, DEFAULT_ENGINE_CONFIG.maxOfflineSeconds);

    expect(summary.secondsApplied).toBe(DEFAULT_ENGINE_CONFIG.maxOfflineSeconds);
    expect(summary.kills).toBeGreaterThan(0);
    expect(summary.stageAfter).toBeGreaterThanOrEqual(stageBefore);
  }, 120_000);

  describe('sliced catch-up', () => {
    /**
     * The rule the whole approach rests on: `step` never consumes past an event,
     * so where the slice boundaries fall cannot change what happened. Summing the
     * same span in different groupings does move the last bits of a float, which
     * is why elapsed time and in-flight positions are compared to a tolerance and
     * everything the player is paid in is compared exactly.
     */
    it.each([1, 7, 10, 60, 300])('lands on the same state as one pass (%ss slices)', (slice) => {
      const span = 900;
      const onePass = new EvercastSimulation();
      new OfflineProgressor(span).apply(onePass, span);

      const sliced = new EvercastSimulation();
      const catchUp = new OfflineProgressor(span).begin(sliced, span);
      while (!catchUp.done) catchUp.advance(slice);

      const expected = onePass.getSnapshot();
      const actual = sliced.getSnapshot();

      expect({
        stage: actual.stage,
        encounterStage: actual.encounterStage,
        mode: actual.mode,
        farmStage: actual.farmStage,
        phase: actual.phase,
        kills: actual.kills,
        casts: actual.casts,
        deaths: actual.deaths,
        gold: actual.gold.raw,
        essence: actual.essence.raw,
        starlight: actual.starlight.raw,
        highestStageEver: actual.highestStageEver,
        spawned: actual.encounterSpawnedEnemies,
        alive: actual.encounterAliveEnemies,
        enemies: actual.enemies.map((enemy) => [enemy.instanceId, enemy.hp.raw]),
      }).toEqual({
        stage: expected.stage,
        encounterStage: expected.encounterStage,
        mode: expected.mode,
        farmStage: expected.farmStage,
        phase: expected.phase,
        kills: expected.kills,
        casts: expected.casts,
        deaths: expected.deaths,
        gold: expected.gold.raw,
        essence: expected.essence.raw,
        starlight: expected.starlight.raw,
        highestStageEver: expected.highestStageEver,
        spawned: expected.encounterSpawnedEnemies,
        alive: expected.encounterAliveEnemies,
        enemies: expected.enemies.map((enemy) => [enemy.instanceId, enemy.hp.raw]),
      });

      expect(actual.elapsedSeconds).toBeCloseTo(expected.elapsedSeconds, 4);
      actual.enemies.forEach((enemy, index) => {
        expect(enemy.position?.x).toBeCloseTo(expected.enemies[index].position?.x ?? 0, 4);
      });
    });

    it('reports only what it has applied so far, and counts down as it goes', () => {
      const simulation = new EvercastSimulation();
      const catchUp = new OfflineProgressor(600).begin(simulation, 600);

      expect(catchUp.remainingSeconds).toBe(600);
      expect(catchUp.advance(120)).toBe(120);
      expect(catchUp.remainingSeconds).toBe(480);
      expect(catchUp.summary().secondsApplied).toBe(120);
      expect(catchUp.done).toBe(false);

      // A slice larger than what is left applies only what is left.
      expect(catchUp.advance(10_000)).toBe(480);
      expect(catchUp.done).toBe(true);
      expect(catchUp.summary().secondsApplied).toBe(600);
      expect(catchUp.advance(60)).toBe(0);
    });

    it('caps each away period in its own right when one is folded into another', () => {
      const simulation = new EvercastSimulation();
      const catchUp = new OfflineProgressor(300).begin(simulation, 10_000);
      expect(catchUp.remainingSeconds).toBe(300);

      catchUp.extend(10_000);
      expect(catchUp.remainingSeconds).toBe(600);
    });

    it('suppresses presentation events across every slice', () => {
      const simulation = new EvercastSimulation();
      const catchUp = new OfflineProgressor(600).begin(simulation, 600);
      while (!catchUp.done) {
        catchUp.advance(10);
        expect(simulation.drainPresentationEvents()).toEqual([]);
      }
    });
  });
});
