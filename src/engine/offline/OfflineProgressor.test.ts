import { describe, expect, it } from 'vitest';
import { EvercastSimulation } from '../EvercastSimulation';
import { OfflineProgressor } from './OfflineProgressor';

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
});
