import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE_CONFIG } from '../config';
import { EvercastSimulation } from '../EvercastSimulation';
// prettier-ignore
import { hasArrived, inAttackRange, laneZ, positionOf, soonestRangeChange, timeToRange } from './SpellCombatState';
import { contactPoint } from './Contact';
import { advanceApproach, distanceSquared } from './SpellCombatState';
import { SaveCodec } from '../save/SaveCodec';
import { quantity } from '../numbers';
import { ENEMIES } from '../../content/enemies';
import { ZONES } from '../../content/zones';
import type { EnemyState } from '../model';

const stopOf = (enemy: EnemyState) => contactPoint(enemy, config.enemyAttackRange);

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
    for (const enemy of simulation.getState().run.enemies) {
      // Its own reach and slot, not one line everything shares.
      expect(enemy.position!.x).toBeGreaterThanOrEqual(stopOf(enemy).x - 1e-6);
      if (hasArrived(enemy, config.enemyAttackRange)) {
        expect(enemy.position!.x).toBeCloseTo(stopOf(enemy).x, 9);
        expect(enemy.position!.z).toBeCloseTo(stopOf(enemy).z, 9);
      }
    }
    // Something has to have arrived by now, or nothing is ever fighting.
    const arrived = runFor(40).getSnapshot().enemies.filter((enemy) => !enemy.approaching);
    expect(arrived.length + runFor(40).getSnapshot().kills).toBeGreaterThan(0);
  });

  it('reports approach state so the renderer can walk them in', () => {
    const early = new EvercastSimulation();
    early.update(config.travelSeconds + 0.05);
    const fresh = early.getState().run.enemies[0];
    if (fresh) {
      expect(early.getSnapshot().enemies[0].approaching).toBe(true);
      expect(fresh.position!.x).toBeGreaterThan(stopOf(fresh).x);
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
    // An odd step, so nothing can be passing by lining up on halves.
    expect(positions(1 / 45)).toEqual(positions(1 / 60));
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
    expect(soonestRangeChange(run, spell, melee, config.enemyApproachSpeed)).toBeCloseTo(
      (13 - spell) / config.enemyApproachSpeed,
      9,
    );
  });

  it('does not let an enemy swing from across the road', () => {
    const simulation = new EvercastSimulation();
    simulation.update(config.travelSeconds + 0.05);
    const before = simulation.getSnapshot();
    const distant = simulation
      .getState()
      .run.enemies.find((enemy) => !hasArrived(enemy, config.enemyAttackRange));
    if (!distant) return;

    // Advance less than it takes to close, and the mage must be untouched.
    const closing = (distant.position!.x - stopOf(distant).x) / config.enemyApproachSpeed;
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
      delete enemy.approachFromZ;
      delete enemy.approachSince;
      // A save from before per-enemy reach carries none of these either.
      delete enemy.attackRange;
      delete enemy.contactSlot;
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

    // Adopting them must also have handed out distinct slots, or they would all
    // stand on top of each other on the spot they share by default.
    const resting = resumed
      .getState()
      .run.enemies.filter((enemy) => legacyIds.has(enemy.instanceId))
      .map((enemy) => `${enemy.position!.x}:${enemy.position!.z}`);
    expect(new Set(resting).size).toBe(resting.length);
  });

  it('positionOf falls back rather than throwing on a legacy enemy', () => {
    expect(positionOf({ } as never)).toEqual(expect.objectContaining({ x: expect.any(Number) }));
  });
});

describe('reach', () => {
  const reach = config.enemyAttackRange;

  it('lets a caster hold its ground where a melee enemy is still walking', () => {
    const spot = { position: { x: 4.6, z: 0 }, contactSlot: 0 };
    const caster = { ...spot, attackRange: 4.6 } as EnemyState;
    const brawler = { ...spot, attackRange: reach } as EnemyState;

    expect(hasArrived(caster, reach)).toBe(true);
    expect(hasArrived(brawler, reach)).toBe(false);
  });

  it('walks each enemy to its own resting place, not to a shared line', () => {
    const walked = (attackRange: number | undefined, contactSlot: number, fromZ: number) => ({
      position: { x: 13, z: fromZ },
      attackRange,
      contactSlot,
      approachFrom: 13,
      approachFromZ: fromZ,
      approachSince: 0,
    });
    // Long after everything has had time to arrive.
    const run = {
      elapsedSeconds: 60,
      enemies: [walked(4.6, 0, 1.35), walked(undefined, 1, -1.35)],
    } as never as { enemies: EnemyState[] };

    advanceApproach(run as never, reach, config.enemyApproachSpeed);

    for (const enemy of run.enemies) {
      expect(enemy.position!.x).toBeCloseTo(stopOf(enemy).x, 9);
      // The lane it came down is gone by the time it plants itself.
      expect(enemy.position!.z).toBeCloseTo(stopOf(enemy).z, 9);
    }
    expect(run.enemies[0].position!.x).toBeCloseTo(4.6, 9);
    expect(run.enemies[1].position!.x).toBeGreaterThan(reach - 1e-9);
    expect(run.enemies[1].position!.x).toBeLessThan(4.6);
  });

  it('gives an enemy carrying nothing a finite place to stand', () => {
    // Older tests and older saves build enemies without any of these fields.
    expect(contactPoint({} as never, reach)).toEqual({ x: reach, z: 0 });
  });

  it('does not let a melee enemy swing from across the road', () => {
    const simulation = new EvercastSimulation();
    const swings: { x: number; stop: number; melee: boolean }[] = [];

    for (let frame = 0; frame < 45 * 60; frame += 1) {
      simulation.update(1 / 60);
      const attacks = simulation
        .drainPresentationEvents()
        .filter((event) => event.type === 'enemy_attack');
      for (const attack of attacks) {
        const enemy = simulation
          .getState()
          .run.enemies.find((candidate) => candidate.instanceId === attack.instanceId);
        // An enemy that died in the same step no longer has a position to read.
        if (enemy?.position)
          swings.push({
            x: enemy.position.x,
            stop: stopOf(enemy).x,
            melee: (enemy.attackRange ?? reach) <= reach,
          });
      }
    }

    expect(swings.length).toBeGreaterThan(0);
    for (const swing of swings) {
      expect(swing.x).toBeLessThanOrEqual(swing.stop + 1e-6);
      // A character is about 1.55 tall and half a unit wide, so the whole melee
      // crowd - front rank and the rank leaning in behind it - fits inside 1.8.
      if (swing.melee) expect(swing.x).toBeLessThanOrEqual(1.8);
    }
    // And somebody has to be fighting from the front rank rather than the whole
    // crowd hanging back, or this is just a shorter standoff. The front slots
    // sit on the reach itself; the rank behind them is half a unit deeper.
    const closest = Math.min(...swings.filter((swing) => swing.melee).map((swing) => swing.x));
    expect(closest).toBeLessThan(config.enemyAttackRange + 0.5);
  });

  it('does not let two enemies come to rest on the same spot', () => {
    const simulation = new EvercastSimulation();
    let shared = 0;
    let crowded = 0;

    for (let frame = 0; frame < 90 * 60; frame += 1) {
      simulation.update(1 / 60);
      const enemies = simulation.getState().run.enemies;
      for (let a = 0; a < enemies.length; a += 1)
        for (let b = a + 1; b < enemies.length; b += 1) {
          const gap = distanceSquared(enemies[a].position!, enemies[b].position!);
          if (gap === 0) shared += 1;
          // Two bodies of radius ~0.3. Enemies still walking may pass close.
          const resting = hasArrived(enemies[a], reach) && hasArrived(enemies[b], reach);
          if (resting && gap < 0.36) crowded += 1;
        }
    }

    expect(shared).toBe(0);
    expect(crowded).toBe(0);
  });
});

describe('windup', () => {
  it('telegraphs a swing before it lands', () => {
    const simulation = new EvercastSimulation();
    const raised = new Map<number, number>();
    const gaps: number[] = [];
    let untelegraphed = 0;

    for (let frame = 0; frame < 45 * 60; frame += 1) {
      simulation.update(1 / 60);
      for (const event of simulation.drainPresentationEvents()) {
        if (event.type === 'enemy_windup') raised.set(event.instanceId, event.time);
        if (event.type === 'enemy_attack') {
          const at = raised.get(event.instanceId);
          if (at === undefined) untelegraphed += 1;
          else gaps.push(event.time - at);
          raised.delete(event.instanceId);
        }
      }
    }

    expect(gaps.length).toBeGreaterThan(0);
    expect(untelegraphed).toBe(0);
    for (const gap of gaps) expect(gap).toBeCloseTo(config.enemyWindupSeconds, 6);
  });
});

describe('saves', () => {
  it('resumes a mid-fight save on the same positions', () => {
    const live = runFor(20);
    const codec = new SaveCodec(config);
    const resumed = new EvercastSimulation({
      initialState: codec.decode(codec.encode(live.getState())).state,
    });

    const positions = (simulation: EvercastSimulation) =>
      simulation
        .getState()
        .run.enemies.map((enemy) => `${enemy.instanceId}:${enemy.position!.x}:${enemy.position!.z}`);

    expect(positions(resumed)).toEqual(positions(live));

    // And a save-and-resume must not drift from a run that never stopped.
    for (let frame = 0; frame < 10 * 60; frame += 1) {
      live.update(1 / 60);
      resumed.update(1 / 60);
    }
    expect(positions(resumed)).toEqual(positions(live));
  });
});

describe('content', () => {
  /** A run where every spawn is the named enemy, so its own reach is the only one on the road. */
  function runOf(enemyId: string) {
    const catalog = {
      enemies: new Map(ENEMIES.map((enemy) => [enemy.id, enemy])),
      zones: [{ ...ZONES[0], enemyIds: [enemyId], bossEnemyId: enemyId }],
    };
    return new EvercastSimulation({ catalog });
  }

  it.each([
    ['moss_slime', config.enemyAttackRange],
    ['hollow_crow', 3],
    ['ember_wisp', 4.6],
  ])('walks a %s in to its authored reach', (enemyId, reach) => {
    // Enemies come and go, so watch where they plant themselves rather than
    // hoping any particular one is still alive at the end.
    const simulation = runOf(enemyId);
    const rested: number[] = [];
    for (let frame = 0; frame < 60 * 60; frame += 1) {
      simulation.update(1 / 60);
      for (const enemy of simulation.getState().run.enemies) {
        expect(enemy.attackRange).toBe(reach);
        if (hasArrived(enemy, config.enemyAttackRange)) rested.push(enemy.position!.x);
      }
    }

    expect(rested.length).toBeGreaterThan(0);
    // Front slot sits on the reach itself; the ranks behind it are deeper.
    expect(Math.min(...rested)).toBeCloseTo(reach, 9);
    expect(Math.max(...rested)).toBeLessThan(reach + 1);
  });

  it('keeps every authored reach inside what the Evercast can answer', () => {
    for (const enemy of ENEMIES) {
      expect(enemy.attackRange ?? config.enemyAttackRange).toBeLessThan(config.spellRange);
    }
  });
});

describe('targeting', () => {
  it('names the enemy the spell is actually aimed at', () => {
    const simulation = new EvercastSimulation();
    let checked = 0;

    for (let frame = 0; frame < 60 * 60; frame += 1) {
      simulation.update(1 / 60);
      const living = simulation.getState().run.enemies.filter((enemy) => enemy.hp.cmp(0) > 0);
      if (living.length === 0) continue;

      const nearest = living.reduce((closest, enemy) =>
        positionOf(enemy).x ** 2 + positionOf(enemy).z ** 2 <
        positionOf(closest).x ** 2 + positionOf(closest).z ** 2
          ? enemy
          : closest,
      );
      const snapshot = simulation.getSnapshot();
      expect(snapshot.enemyName).toBe(nearest.name);
      // Names repeat within a wave; the health is what pins it to one enemy.
      expect(snapshot.enemyHp.raw).toBe(quantity(nearest.hp).raw);
      checked += 1;
    }

    expect(checked).toBeGreaterThan(0);
  });
});
