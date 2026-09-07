import { describe, expect, it } from 'vitest';
import { EvercastSimulation } from './EvercastSimulation';
import { createDefaultSpellBuild } from './spell/SpellCompiler';

describe('EvercastSimulation', () => {
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
});
