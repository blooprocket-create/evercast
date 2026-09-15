import { describe, expect, it } from 'vitest';
import Decimal from 'break_eternity.js';
// prettier-ignore
import { COUNTER_MAX_CHARGES, COUNTER_RECHARGE_SECONDS, STAGGER_AMPLIFICATION, STAGGER_SECONDS, SURGE_EVERY, SURGE_OFFSET } from '../../content/combatTuning';
import { DEFAULT_ENGINE_CONFIG } from '../config';
import { EvercastSimulation } from '../EvercastSimulation';
import type { GameEvent } from '../events/GameEvent';
import type { EnemyState, RunState } from '../model';
import { big } from '../numbers';
import { SaveCodec } from '../save/SaveCodec';
import { createInitialGameState } from '../state';
import { resolveEnemyBeats, windupFor } from './EnemyTurns';
// prettier-ignore
import { breakSurge, counterspellState, isSurgeSwing, staggerMultiplier, surgeWindup, surgingEnemy, tickCounterspell } from './Surge';

const REACH = DEFAULT_ENGINE_CONFIG.enemyAttackRange;

/*
 * Read off the tuning rather than written in: which swing surges is a number
 * that moves with measurement (see `combatTuning.ts`), and a suite that hard
 * coded it would have to be rewritten every time it did.
 */
const SURGING = SURGE_OFFSET;
const QUIET = SURGE_OFFSET + 1;

/** A boss standing in contact, so every gate that asks about reach says yes. */
function boss(overrides: Partial<EnemyState> = {}): EnemyState {
  return {
    instanceId: 1,
    definitionId: 'road_warden',
    name: 'Road Warden',
    stage: 10,
    boss: true,
    hp: big(1000),
    maxHp: big(1000),
    attackDamage: big(10),
    attackInterval: 1.9,
    attackCooldown: 1.9,
    position: { x: 0.5, z: 0 },
    ...overrides,
  };
}

function runWith(enemies: EnemyState[]): RunState {
  const state = createInitialGameState(DEFAULT_ENGINE_CONFIG);
  state.run.enemies = enemies;
  return state.run;
}

describe('the Surge', () => {
  it('is a boss swing and nothing else', () => {
    expect(isSurgeSwing(boss({ swings: SURGING }))).toBe(true);
    expect(isSurgeSwing(boss({ boss: false, swings: SURGING }))).toBe(false);
  });

  it('arrives on a cycle rather than on every swing', () => {
    const cycle = Array.from({ length: SURGE_EVERY * 2 }, (_, swings) =>
      isSurgeSwing(boss({ swings })),
    );
    expect(cycle.filter(Boolean)).toHaveLength(2);
    // Early enough that a player meets the mechanic in their first boss fight.
    expect(cycle.indexOf(true)).toBeLessThan(SURGE_EVERY);
  });

  it('is telegraphed far longer than an ordinary swing', () => {
    const ordinary = windupFor(boss({ swings: QUIET }), DEFAULT_ENGINE_CONFIG);
    const surge = windupFor(boss({ swings: SURGING }), DEFAULT_ENGINE_CONFIG);
    expect(surge).toBeGreaterThan(ordinary * 4);
    // ...but never longer than the cadence it announces, or the boss would read
    // as permanently wound up rather than as raising a threat.
    expect(surge).toBeLessThan(1.9);
  });

  /**
   * The invariant the whole mechanic is built on, in two halves. A Surge
   * replaces a boss swing and never adds one, so a player who is away - or who
   * never presses the button - faces exactly the boss they faced before.
   */
  describe('costs an absent player nothing', () => {
    it('does not move the blow it announces', () => {
      const run = runWith([boss({ swings: SURGING, attackCooldown: 1.5 })]);
      const before = run.enemies[0]!.attackCooldown;
      resolveEnemyBeats(run, DEFAULT_ENGINE_CONFIG, () => {});
      expect(run.enemies[0]!.telegraphed).toBe(true);
      expect(run.enemies[0]!.attackCooldown).toBe(before);
    });

    it('lands for the ordinary damage when it is not answered', () => {
      const surged: GameEvent[] = [];
      const ordinary: GameEvent[] = [];
      for (const [swings, sink] of [
        [1, surged],
        [0, ordinary],
      ] as const) {
        const simulation = new EvercastSimulation();
        const state = simulation.getState();
        state.run.enemies = [boss({ swings, attackCooldown: 0 })];
        state.run.phase = 'combat';
        state.run.encounter = {
          stage: 10, totalEnemies: 1, spawnedEnemies: 1,
          spawnInterval: 1, spawnCooldown: 99, maxAlive: 1, bossStage: true,
        };
        simulation.advance(0.01);
        sink.push(...simulation.drainPresentationEvents());
      }
      const damageOf = (events: GameEvent[]) =>
        events.find((event) => event.type === 'enemy_attack')?.damage;
      expect(damageOf(surged)).toBeDefined();
      expect(damageOf(surged)).toBe(damageOf(ordinary));
    });
  });

  it('marks its telegraph so the interface can tell the two apart', () => {
    const events: GameEvent[] = [];
    resolveEnemyBeats(runWith([boss({ swings: SURGING, attackCooldown: 1.5 })]), DEFAULT_ENGINE_CONFIG, (e) =>
      events.push(e),
    );
    expect(events.find((event) => event.type === 'enemy_windup')?.surge).toBe(true);

    events.length = 0;
    resolveEnemyBeats(runWith([boss({ swings: QUIET, attackCooldown: 0.2 })]), DEFAULT_ENGINE_CONFIG, (e) =>
      events.push(e),
    );
    expect(events.find((event) => event.type === 'enemy_windup')?.surge).toBeUndefined();
  });
});

describe('breaking a Surge', () => {
  const live = () => runWith([boss({ swings: SURGING, attackCooldown: 1.0 })]);

  it('is offered only while the window is open', () => {
    expect(surgingEnemy(live(), REACH)).toBeDefined();
    // Too early: the telegraph has not started yet.
    expect(surgingEnemy(runWith([boss({ swings: SURGING, attackCooldown: 1.85 })]), REACH)).toBeUndefined();
    // Not a Surge at all.
    expect(surgingEnemy(runWith([boss({ swings: QUIET, attackCooldown: 0.2 })]), REACH)).toBeUndefined();
    // Still walking, so not swinging.
    expect(
      surgingEnemy(runWith([boss({ swings: SURGING, attackCooldown: 1, position: { x: 9, z: 0 } })]), REACH),
    ).toBeUndefined();
  });

  it('cancels the blow, spends a charge and leaves the boss reeling', () => {
    const run = live();
    const events: GameEvent[] = [];
    const outcome = breakSurge(run, REACH, (event) => events.push(event));

    expect(outcome).toBeDefined();
    expect(counterspellState(run).charges).toBe(COUNTER_MAX_CHARGES - 1);
    // Pushed out by a whole interval: the swing is cancelled, not deferred.
    expect(run.enemies[0]!.attackCooldown).toBeCloseTo(1.0 + 1.9);
    expect(staggerMultiplier(run, run.enemies[0]!)).toBe(1 + STAGGER_AMPLIFICATION);
    expect(events.find((event) => event.type === 'surge_broken')).toMatchObject({
      instanceId: 1,
      staggerSeconds: STAGGER_SECONDS,
    });
  });

  it('advances the cycle, so a countered boss cannot wind another straight back up', () => {
    const run = live();
    breakSurge(run, REACH, () => {});
    expect(isSurgeSwing(run.enemies[0]!)).toBe(false);
  });

  it('refuses when there is nothing in the air, and when there is nothing to spend', () => {
    const quiet = runWith([boss({ swings: QUIET, attackCooldown: 1.9 })]);
    expect(breakSurge(quiet, REACH, () => {})).toBeUndefined();

    const spent = live();
    counterspellState(spent).charges = 0;
    expect(breakSurge(spent, REACH, () => {})).toBeUndefined();
    // A refused command costs nothing: the blow is still coming.
    expect(spent.enemies[0]!.attackCooldown).toBe(1.0);
  });

  it('opens the same window for the party as for the mage', () => {
    const run = live();
    breakSurge(run, REACH, () => {});
    const enemy = run.enemies[0]!;
    expect(staggerMultiplier(run, enemy)).toBeGreaterThan(1);
    run.elapsedSeconds += STAGGER_SECONDS + 0.01;
    expect(staggerMultiplier(run, enemy)).toBe(1);
  });
});

describe('Counterspell charges', () => {
  it('start full, so a returning player is never short of one', () => {
    expect(counterspellState(runWith([])).charges).toBe(COUNTER_MAX_CHARGES);
  });

  it('come back on a clock and stop at the cap', () => {
    const run = runWith([]);
    const counter = counterspellState(run);
    counter.charges = 0;
    counter.recharge = COUNTER_RECHARGE_SECONDS;

    tickCounterspell(run, COUNTER_RECHARGE_SECONDS - 0.01);
    expect(counter.charges).toBe(0);
    tickCounterspell(run, 0.02);
    expect(counter.charges).toBe(1);

    // One long step - a slow frame, or offline catch-up - is worth more than
    // one charge, and still cannot exceed the cap.
    tickCounterspell(run, COUNTER_RECHARGE_SECONDS * 1000);
    expect(counter.charges).toBe(COUNTER_MAX_CHARGES);
  });
});

describe('the Surge inside the real loop', () => {
  /**
   * A boss encounter staged directly rather than ground out to stage 10. A
   * default build cannot actually reach a boss unaided, and a test that spent
   * ten thousand steps trying would be measuring the economy, not this.
   */
  function atABoss(): EvercastSimulation {
    const simulation = new EvercastSimulation();
    const state = simulation.getState();
    state.run.phase = 'combat';
    state.run.enemies = [boss({ hp: big(1e9), maxHp: big(1e9), swings: QUIET })];
    state.run.encounter = {
      stage: 10, totalEnemies: 1, spawnedEnemies: 1,
      spawnInterval: 1, spawnCooldown: 99, maxAlive: 1, bossStage: true,
    };
    return simulation;
  }

  it('opens a window the snapshot can describe, and a command can answer', () => {
    const simulation = atABoss();
    expect(simulation.getSnapshot().boss).toBe(true);

    let sawSurge = false;
    for (let i = 0; i < 400 && !sawSurge; i += 1) {
      simulation.advance(0.05);
      sawSurge = simulation.getSnapshot().surge !== null;
    }
    expect(sawSurge).toBe(true);

    const snapshot = simulation.getSnapshot();
    expect(snapshot.surge!.secondsRemaining).toBeGreaterThan(0);
    expect(snapshot.surge!.secondsRemaining).toBeLessThanOrEqual(snapshot.surge!.windowSeconds);
    expect(snapshot.counterspell.ready).toBe(true);

    expect(simulation.execute({ type: 'counterspell' })).toBe(true);
    const after = simulation.getSnapshot();
    expect(after.surge).toBeNull();
    expect(after.counterspell.charges).toBe(COUNTER_MAX_CHARGES - 1);
  });

  it('refuses the command when no window is open', () => {
    expect(new EvercastSimulation().execute({ type: 'counterspell' })).toBe(false);
  });

  it('does not change what the loop stops on, so chunked and single-pass agree', () => {
    const single = new EvercastSimulation();
    single.advance(600);

    const chunked = new EvercastSimulation();
    for (let i = 0; i < 6000; i += 1) chunked.advance(0.1);

    const compare = (simulation: EvercastSimulation) => {
      const snapshot = simulation.getSnapshot();
      return { stage: snapshot.stage, kills: snapshot.kills, gold: snapshot.gold.display };
    };
    expect(compare(chunked)).toEqual(compare(single));
  });
});

describe('a Surge across a save', () => {
  const codec = new SaveCodec(DEFAULT_ENGINE_CONFIG);
  const roundTrip = (envelope: unknown) =>
    codec.decode(JSON.parse(JSON.stringify(envelope))).state;

  it('keeps the pool, the cycle and the reeling', () => {
    const state = createInitialGameState(DEFAULT_ENGINE_CONFIG);
    state.run.enemies = [boss({ swings: 4 })];
    state.run.enemies[0]!.statuses = {
      stagger: { amplification: STAGGER_AMPLIFICATION, expiresAt: 12 },
    };
    counterspellState(state.run).charges = 1;

    const restored = roundTrip(codec.encode(state));
    expect(restored.run.counter?.charges).toBe(1);
    expect(restored.run.enemies[0]?.swings).toBe(4);
    expect(restored.run.enemies[0]?.statuses?.stagger?.expiresAt).toBe(12);
  });

  it('hands a save written before Surges existed a full pool', () => {
    const envelope = JSON.parse(
      JSON.stringify(codec.encode(createInitialGameState(DEFAULT_ENGINE_CONFIG))),
    );
    delete envelope.state.run.counter;
    expect(codec.decode(envelope).state.run.counter?.charges).toBe(COUNTER_MAX_CHARGES);
  });

  it('refuses a stagger an edited save invented', () => {
    const state = createInitialGameState(DEFAULT_ENGINE_CONFIG);
    state.run.enemies = [boss()];
    const envelope = JSON.parse(JSON.stringify(codec.encode(state)));
    envelope.state.run.enemies[0].statuses = { stagger: { amplification: 9999, expiresAt: 1e9 } };
    const restored = codec.decode(envelope).state;
    expect(restored.run.enemies[0]?.statuses?.stagger?.amplification).toBe(STAGGER_AMPLIFICATION);
  });
});

describe('a staggered enemy', () => {
  it('takes more from every source, and only while it is reeling', () => {
    const run = runWith([boss()]);
    const enemy = run.enemies[0]!;
    expect(staggerMultiplier(run, enemy)).toBe(1);
    enemy.statuses = { stagger: { amplification: 0.5, expiresAt: 5 } };
    expect(staggerMultiplier(run, enemy)).toBe(1.5);
    run.elapsedSeconds = 5;
    expect(staggerMultiplier(run, enemy)).toBe(1);
  });

  it('expires against the run clock, so a resumed save does not resurrect it', () => {
    const run = runWith([boss()]);
    run.elapsedSeconds = 100;
    run.enemies[0]!.statuses = { stagger: { amplification: 0.5, expiresAt: 99 } };
    expect(staggerMultiplier(run, run.enemies[0]!)).toBe(1);
  });
});

/** Guards the shape `surgeWindup` promises, which two other modules rely on. */
describe('surgeWindup', () => {
  it('never outlasts the cadence it announces', () => {
    for (const interval of [0.2, 0.5, 1.9, 2.4, 10]) {
      expect(surgeWindup(boss({ attackInterval: interval }))).toBeLessThan(interval);
    }
  });
});

/** Nothing here should have taught the engine about Decimal-free enemies. */
it('leaves enemy health a Decimal throughout', () => {
  const run = runWith([boss({ swings: SURGING, attackCooldown: 1 })]);
  breakSurge(run, REACH, () => {});
  expect(run.enemies[0]!.hp).toBeInstanceOf(Decimal);
});
