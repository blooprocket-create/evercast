import { describe, expect, it } from 'vitest';
import { EvercastSimulation } from '../EvercastSimulation';

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
});
