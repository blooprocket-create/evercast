import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GEAR_SLOT_ORDER } from '../gear/GearCatalog';
import { CHRONICLE_DEPTH, Chronicle } from './Chronicle';
import { EVERY_EVENT } from './everyGameEvent';
import type { GameEvent } from './GameEvent';
import { logWeight } from './logWeight';

const stage = (n: number): GameEvent => ({ type: 'stage_advanced', time: n, stage: n });
const kill = (n: number): GameEvent => ({
  type: 'enemy_killed', time: n, stage: 1, instanceId: n, enemyId: 'moss_slime', gold: '3',
});
const defeat = (n: number): GameEvent => ({ type: 'mage_defeated', time: n, stage: n });

describe('what earns a line', () => {
  it('classifies every variant in the union', () => {
    // Counted from the union itself, so a variant added without a decision in
    // `logWeight` fails here rather than falling through to `undefined`.
    const source = readFileSync(join(process.cwd(), 'src', 'engine', 'events', 'GameEvent.ts'), 'utf8');
    const declared = new Set([...source.matchAll(/type: '([a-z_]+)'/g)].map((match) => match[1]));
    const covered = new Set(EVERY_EVENT.map((event) => event.type));
    expect([...declared].filter((kind) => !covered.has(kind as never))).toEqual([]);
    for (const event of EVERY_EVENT) expect(logWeight(event)).toBeDefined();
  });

  it('keeps combat out of it', () => {
    // The thing the old log did wrong. All of this is already on screen, and
    // it is the only thing in the game that happens faster than reading.
    const combat = EVERY_EVENT.filter((event) =>
      ['spell_cast', 'projectile_hit', 'effect_hit', 'enemy_attack', 'enemy_killed', 'status_applied', 'combat_state', 'companion_attack', 'companion_ability'].includes(event.type),
    );
    expect(combat.length).toBeGreaterThan(20);
    expect(combat.filter((event) => logWeight(event).line)).toEqual([]);
  });

  it('draws the line at a boss', () => {
    const ordinary: GameEvent = { type: 'encounter_started', time: 1, stage: 4, totalEnemies: 6, boss: false };
    const boss: GameEvent = { ...ordinary, boss: true };
    expect(logWeight(ordinary).line).toBe(false);
    expect(logWeight(boss).line).toBe(true);
  });

  it('keeps everything a player chose or had happen to them', () => {
    const decisive = EVERY_EVENT.filter((event) =>
      ['mage_defeated', 'gear_evolved', 'spell_node_activated', 'attunement_purchased', 'rebirth_performed', 'companion_downed', 'companion_summoned', 'companion_ascended'].includes(event.type),
    );
    expect(decisive.length).toBeGreaterThan(5);
    expect(decisive.filter((event) => !logWeight(event).line)).toEqual([]);
  });
});

describe('the chronicle', () => {
  it('holds a run of continuous progress to a single ticking line', () => {
    // Pushing advances the frontier every few seconds. Without this, one
    // minute of play buries everything else that has ever happened.
    const chronicle = new Chronicle();
    for (let n = 1; n <= 200; n += 1) chronicle.record(stage(n));

    expect(chronicle.read()).toHaveLength(1);
    expect(chronicle.read()[0]!.text).toBe('Frontier advanced to stage 200.');
  });

  it('only folds a run, never across one', () => {
    const chronicle = new Chronicle();
    chronicle.record(stage(1));
    chronicle.record(stage(2));
    chronicle.record(defeat(3));
    chronicle.record(stage(4));

    expect(chronicle.read().map((line) => line.text)).toEqual([
      'Frontier advanced to stage 2.',
      'The mage falls at stage 3.',
      'Frontier advanced to stage 4.',
    ]);
  });

  it('folds gear levels per slot, so one piece cannot swallow another', () => {
    const chronicle = new Chronicle();
    const [first, second] = GEAR_SLOT_ORDER;
    chronicle.record({ type: 'gear_leveled', time: 1, slot: first!, level: 4, cost: '10' });
    chronicle.record({ type: 'gear_leveled', time: 2, slot: first!, level: 5, cost: '11' });
    chronicle.record({ type: 'gear_leveled', time: 3, slot: second!, level: 2, cost: '12' });

    const lines = chronicle.read();
    expect(lines).toHaveLength(2);
    expect(lines[0]!.text).toMatch(/level 5\.$/);
    expect(lines[1]!.text).toMatch(/level 2\.$/);
  });

  it('never grows past its depth, however long the absence was', () => {
    // An offline settle can emit tens of thousands of events in one frame.
    const chronicle = new Chronicle();
    for (let n = 1; n <= CHRONICLE_DEPTH * 5; n += 1) chronicle.record(defeat(n));

    const lines = chronicle.read();
    expect(lines).toHaveLength(CHRONICLE_DEPTH);
    // The newest survive, not the oldest: what the player missed is the tail.
    expect(lines[lines.length - 1]!.text).toBe(`The mage falls at stage ${CHRONICLE_DEPTH * 5}.`);
  });

  it('numbers its lines monotonically, folded ones included', () => {
    const chronicle = new Chronicle();
    chronicle.record(stage(1));
    chronicle.record(stage(2));
    chronicle.record(defeat(3));

    const seqs = chronicle.read().map((line) => line.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('hands out the same array until there is something new in it', () => {
    // The snapshot is rebuilt several times a second and the log changes
    // rarely; a fresh array every publish would re-render the shelf and the
    // Chronicle surface on every frame for nothing.
    const chronicle = new Chronicle();
    chronicle.record(defeat(1));
    const first = chronicle.read();

    for (let n = 0; n < 500; n += 1) chronicle.record(kill(n));
    expect(chronicle.read()).toBe(first);

    chronicle.record(defeat(2));
    expect(chronicle.read()).not.toBe(first);
  });

  it('starts empty, because a chronicle is about this session', () => {
    expect(new Chronicle().read()).toEqual([]);
  });

  it('stamps each line with the run time it happened at', () => {
    const chronicle = new Chronicle();
    chronicle.record(defeat(612.5));
    expect(chronicle.read()[0]!.at).toBe(612.5);
  });
});
