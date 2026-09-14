import { describe, expect, it } from 'vitest';
import { EvercastSimulation } from '../EvercastSimulation';
import { masteryMultiplier } from './Mastery';

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

  it('compounds across successive rebirths', () => {
    const sim = new EvercastSimulation({ config: { rebirthUnlockStage: 2 } });
    const multipliers: number[] = [];
    for (let round = 0; round < 3; round += 1) {
      sim.advance(30, { presentationEvents: false });
      expect(sim.execute({ type: 'rebirth' })).toBe(true);
      multipliers.push(masteryMultiplier(sim.getState().meta).toNumber());
    }
    expect(multipliers[1]).toBeGreaterThan(multipliers[0]);
    expect(multipliers[2]).toBeGreaterThan(multipliers[1]);
  });
});
