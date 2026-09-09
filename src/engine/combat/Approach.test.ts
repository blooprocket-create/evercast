import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE_CONFIG } from '../config';
import { EvercastSimulation } from '../EvercastSimulation';
import { inAttackRange, laneZ, positionOf, soonestRangeChange, timeToRange } from './SpellCombatState';

const config = DEFAULT_ENGINE_CONFIG;

function runFor(seconds: number, step = 1 / 60): EvercastSimulation {
  const simulation = new EvercastSimulation();
  for (let elapsed = 0; elapsed < seconds; elapsed += step) simulation.update(step);
  return simulation;
}

/** Every enemy that has ever existed in the first `seconds` of a run. */
function seenEnemies(seconds: number) {
  const simulation = new EvercastSimulation();
  const seen = new Map<number, { z: number; firstX: number }>();
  for (let elapsed = 0; elapsed < seconds; elapsed += 1 / 60) {
    simulation.update(1 / 60);
    for (const enemy of simulation.getSnapshot().enemies) {
      if (!enemy.position || seen.has(enemy.instanceId)) continue;
      seen.set(enemy.instanceId, { z: enemy.position.z, firstX: enemy.position.x });
    }
  }
  return [...seen.values()];
}

describe('lanes', () => {
  it('places three lanes symmetrically about the road', () => {
    expect(laneZ(0, config.laneSpacing)).toBeCloseTo(-config.laneSpacing, 9);
    expect(laneZ(1, config.laneSpacing)).toBe(0);
    expect(laneZ(2, config.laneSpacing)).toBeCloseTo(config.laneSpacing, 9);
  });

  it('spreads a run across every lane rather than a single file', () => {
    const lanes = new Set(seenEnemies(90).map((enemy) => Math.round(enemy.z * 1000) / 1000));
    expect(lanes.size).toBe(config.laneCount);
    for (const z of lanes) {
      expect(Math.abs(z)).toBeLessThanOrEqual(config.laneSpacing + 1e-6);
    }
  });

  it('is the same spread every time, for the same seed', () => {
    const first = seenEnemies(45).map((enemy) => enemy.z);
    const second = seenEnemies(45).map((enemy) => enemy.z);
    expect(second).toEqual(first);
  });
});

describe('approach', () => {
  it('brings enemies in from off screen rather than on top of the mage', () => {
    for (const enemy of seenEnemies(45)) {
      // Bosses start a little closer, hence the ratio rather than equality.
      expect(enemy.firstX).toBeGreaterThan(config.spellRange);
      expect(enemy.firstX).toBeLessThanOrEqual(config.enemySpawnDistance + 1e-6);
    }
  });

  it('closes the distance and stops at reach', () => {
    const simulation = runFor(40);
    for (const enemy of simulation.getSnapshot().enemies) {
      expect(enemy.position!.x).toBeGreaterThanOrEqual(config.enemyAttackRange - 1e-6);
    }
    // Something has to have arrived by now, or nothing is ever fighting.
    const arrived = runFor(40).getSnapshot().enemies.filter((enemy) => !enemy.approaching);
    expect(arrived.length + runFor(40).getSnapshot().kills).toBeGreaterThan(0);
  });

  it('reports approach state so the renderer can walk them in', () => {
    const early = new EvercastSimulation();
    early.update(config.travelSeconds + 0.05);
    const fresh = early.getSnapshot().enemies[0];
    if (fresh) {
      expect(fresh.approaching).toBe(true);
      expect(fresh.position!.x).toBeGreaterThan(config.enemyAttackRange);
    }
  });

  it('lands on identical positions however the run is chunked', () => {
    const positions = (step: number) =>
      runFor(30, step)
        .getSnapshot()
        .enemies.map((enemy) => `${enemy.instanceId}:${enemy.position!.x}:${enemy.position!.z}`);
    // A save-and-resume takes different step sizes than a live frame loop.
    expect(positions(1 / 30)).toEqual(positions(1 / 60));
    expect(positions(1 / 120)).toEqual(positions(1 / 60));
  });
});

describe('range', () => {
  it('treats arriving exactly on the boundary as arrived', () => {
    // Without the tolerance this is the case that spins the combat loop.
    const atBoundary = { position: { x: 9.000000000000002, z: 0 } } as never;
    expect(inAttackRange(atBoundary, 9)).toBe(true);
    expect(timeToRange(atBoundary, 9, 2.4)).toBe(0);
  });

  it('schedules a crossing for every threshold that changes behaviour', () => {
    const run = { enemies: [{ position: { x: 13, z: 0 } }] } as never;
    const melee = config.enemyAttackRange;
    const spell = config.spellRange;
    // The spell threshold is crossed first, so it is the next event.
    expect(soonestRangeChange(run, [melee, spell], config.enemyApproachSpeed)).toBeCloseTo(
      (13 - spell) / config.enemyApproachSpeed,
      9,
    );
  });

  it('does not let an enemy swing from across the road', () => {
    const simulation = new EvercastSimulation();
    simulation.update(config.travelSeconds + 0.05);
    const before = simulation.getSnapshot();
    const distant = before.enemies.find((enemy) => enemy.approaching);
    if (!distant) return;

    // Advance less than it takes to close, and the mage must be untouched.
    const closing = (distant.position!.x - config.enemyAttackRange) / config.enemyApproachSpeed;
    simulation.update(closing * 0.5);
    expect(simulation.getSnapshot().mageHp.raw).toBe(before.mageHp.raw);
  });

  it('does not stall on an enemy saved before approach existed', () => {
    // A save from before this change has a position but no anchor. Without the
    // adoption in advanceApproach it never moves, never arrives, and stays the
    // next event forever - the combat loop spins until the safety limit.
    const simulation = new EvercastSimulation();
    // Advance until a wave is actually on the road; waves come and go.
    for (let i = 0; i < 3000 && simulation.getState().run.enemies.length === 0; i += 1) {
      simulation.update(1 / 60);
    }

    const state = simulation.getState();
    for (const enemy of state.run.enemies) {
      enemy.position = { x: 2.4, z: 0 };
      delete enemy.approachFrom;
      delete enemy.approachSince;
    }

    const legacyIds = new Set(state.run.enemies.map((enemy) => enemy.instanceId));
    expect(legacyIds.size).toBeGreaterThan(0);

    const resumed = new EvercastSimulation({ initialState: state });
    expect(() => resumed.update(20)).not.toThrow();

    // Those particular enemies must have closed in (or died); anything that
    // spawned afterwards is a fresh arrival and is allowed to still be walking.
    for (const enemy of resumed.getSnapshot().enemies) {
      if (!legacyIds.has(enemy.instanceId)) continue;
      expect(enemy.position!.x).toBeLessThanOrEqual(2.4 + 1e-6);
    }
  });

  it('positionOf falls back rather than throwing on a legacy enemy', () => {
    expect(positionOf({ } as never)).toEqual(expect.objectContaining({ x: expect.any(Number) }));
  });
});
