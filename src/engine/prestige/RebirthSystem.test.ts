import { describe, expect, it } from 'vitest';
import { EvercastSimulation } from '../EvercastSimulation';
import { DEFAULT_ENGINE_CONFIG } from '../config';
import { big } from '../numbers';
import { createInitialGameState } from '../state';
import { masteryMultiplier } from './Mastery';
import { RebirthSystem } from './RebirthSystem';

describe('rebirth boundary', () => {
  it('resets run state while preserving meta progression', () => {
    const sim = new EvercastSimulation({ config: { rebirthUnlockStage: 2 } });
    sim.advance(30, { presentationEvents: false });
    const before = sim.getSnapshot();
    expect(before.canRebirth).toBe(true);
    expect(sim.execute({ type: 'rebirth' })).toBe(true);
    const after = sim.getSnapshot();
    expect(after.stage).toBe(1);
    expect(after.rebirths).toBe(1);
    expect(Number(after.knowledge.raw)).toBeGreaterThan(0);
  });

  it('banks lifetime Knowledge, which spending never takes back', () => {
    const sim = new EvercastSimulation({ config: { rebirthUnlockStage: 2 } });
    sim.advance(30, { presentationEvents: false });
    expect(sim.execute({ type: 'rebirth' })).toBe(true);

    const { knowledge, lifetimeKnowledge } = sim.getState().meta;
    expect(lifetimeKnowledge.cmp(0)).toBeGreaterThan(0);
    expect(lifetimeKnowledge.toString()).toBe(knowledge.toString());
  });

  /**
   * The literal statement of "a Rebirth is a power gain". Before Mastery this
   * was false: the frontier went back to 1 and the account got nothing for it
   * but a currency, so prestige was a pure tax. Gear survives a Rebirth, so
   * holding it constant is what isolates the multiplier.
   */
  it('leaves the mage stronger than the run that earned it', () => {
    const sim = new EvercastSimulation({ config: { rebirthUnlockStage: 2 } });
    sim.advance(30, { presentationEvents: false });

    const before = sim.getState();
    const gearBefore = JSON.stringify(before.equipment.pieces);
    const healthBefore = before.run.mage.maxHp;
    expect(masteryMultiplier(before.meta).toString()).toBe('1');

    expect(sim.execute({ type: 'rebirth' })).toBe(true);

    const after = sim.getState();
    expect(JSON.stringify(after.equipment.pieces)).toBe(gearBefore);
    expect(masteryMultiplier(after.meta).cmp(1)).toBeGreaterThan(0);
    // Computed after the Knowledge was banked, so the fresh run already stands
    // on what the Rebirth just bought rather than starting one Rebirth behind.
    expect(after.run.mage.maxHp.cmp(healthBefore)).toBeGreaterThan(0);
    expect(after.run.mage.hp.toString()).toBe(after.run.mage.maxHp.toString());
  });

  it('compounds across successive rebirths that each go deeper', () => {
    const sim = new EvercastSimulation({ config: { rebirthUnlockStage: 2 } });
    const multipliers: number[] = [];
    for (let round = 0; round < 3; round += 1) {
      // Climb until this run has beaten the record the last one set - which is
      // now what a Rebirth is paid for.
      for (let guard = 0; guard < 400 && !sim.getSnapshot().canRebirth; guard += 1) {
        sim.advance(30, { presentationEvents: false });
      }
      expect(sim.getSnapshot().canRebirth).toBe(true);
      expect(sim.execute({ type: 'rebirth' })).toBe(true);
      multipliers.push(masteryMultiplier(sim.getState().meta).toNumber());
    }
    expect(multipliers[1]).toBeGreaterThan(multipliers[0]);
    expect(multipliers[2]).toBeGreaterThan(multipliers[1]);
  });

  /**
   * Equipment and gold survive a Rebirth, so a player who has been deep can
   * re-reach the unlock stage in minutes. Paying full worth every time made that
   * the best play in the game - measured at 10.9 Knowledge per hour against 1.8
   * for pushing as deep as the run could go - and Mastery would have turned it
   * from a pointless exploit into the dominant strategy.
   */
  it('pays on the margin, so only a deeper run is worth anything', () => {
    const state = createInitialGameState(DEFAULT_ENGINE_CONFIG);
    const system = new RebirthSystem(DEFAULT_ENGINE_CONFIG, () => {});
    const worth = (stage: number) =>
      Math.floor(Math.pow(stage / DEFAULT_ENGINE_CONFIG.rebirthUnlockStage, 1.5));

    state.run.highestStageThisRun = 200;
    expect(system.previewKnowledgeGain(state).toNumber()).toBe(worth(200));
    expect(system.perform(state)).toBe(true);
    expect(state.meta.lifetimeKnowledge.toNumber()).toBe(worth(200));

    // A second run to the same depth adds nothing. Equipment and gold survive a
    // Rebirth, so re-reaching a record takes minutes - and paying full worth for
    // it made spam the best play in the game by a factor of six.
    state.run.highestStageThisRun = 200;
    expect(system.previewKnowledgeGain(state).cmp(0)).toBe(0);
    expect(system.canRebirth(state)).toBe(false);
    expect(system.perform(state)).toBe(false);
    expect(state.meta.lifetimeKnowledge.toNumber()).toBe(worth(200));

    // A deeper one pays the difference, and nothing more.
    state.run.highestStageThisRun = 250;
    expect(system.previewKnowledgeGain(state).toNumber()).toBe(worth(250) - worth(200));
    expect(system.perform(state)).toBe(true);
    expect(state.meta.lifetimeKnowledge.toNumber()).toBe(worth(250));
  });

  it('names the frontier the next point of Knowledge is waiting for', () => {
    const state = createInitialGameState(DEFAULT_ENGINE_CONFIG);
    const system = new RebirthSystem(DEFAULT_ENGINE_CONFIG, () => {});

    // A disabled Rebirth has to be able to say what it is waiting for, rather
    // than only greying out.
    for (const banked of [0, 8, 27]) {
      state.meta.lifetimeKnowledge = big(banked);
      const stage = system.nextKnowledgeStage(state);
      state.run.highestStageThisRun = stage - 1;
      expect(system.canRebirth(state)).toBe(false);
      expect(system.previewKnowledgeGain(state).toString()).toBe('0');
      state.run.highestStageThisRun = stage;
      expect(system.canRebirth(state)).toBe(true);
    }
  });
});
