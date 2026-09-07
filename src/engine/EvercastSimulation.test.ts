import { describe, expect, it } from 'vitest';
import { EvercastSimulation } from './EvercastSimulation';

describe('EvercastSimulation', () => {
  it('advances without depending on a renderer', () => {
    const sim = new EvercastSimulation();
    for (let i = 0; i < 300; i += 1) sim.update(0.1);
    const snapshot = sim.getSnapshot();
    expect(snapshot.elapsedSeconds).toBeGreaterThan(29);
    expect(snapshot.stage).toBeGreaterThan(1);
    expect(snapshot.kills).toBeGreaterThan(0);
  });
});
