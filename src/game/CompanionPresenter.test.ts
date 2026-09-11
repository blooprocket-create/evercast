import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NullEngine, Scene, Vector3 } from '@babylonjs/core';
import { CompanionPresenter } from './CompanionPresenter';
import { DamageNumbers } from './vfx/DamageNumbers';
import type { GameEvent } from '../engine/events/GameEvent';
import type { CompanionSnapshot, SimulationSnapshot } from '../engine/types';

let engine: NullEngine;
let scene: Scene;
let presenter: CompanionPresenter;
/** Everything the presenter asked the label pool to draw. */
let drawn: string[];

function member(overrides: Partial<CompanionSnapshot> = {}): CompanionSnapshot {
  return {
    definitionId: 'hedge_warden',
    name: 'Hedge Warden',
    description: '',
    rarity: 'common',
    companionClass: 'vanguard',
    row: 'front',
    kind: 'humanoid',
    modelKey: 'humanoid_heavy',
    stars: 1,
    shards: 0,
    shardsForNextStar: 20,
    canAscend: false,
    ability: { id: 'guard', magnitude: 0.06, cooldown: 0 },
    abilityMagnitude: 0.06,
    attackInterval: 2.6,
    threat: 8,
    maxHp: { raw: '40', display: '40' },
    damage: { raw: '4', display: '4' },
    slot: 0,
    hp: { raw: '40', display: '40' },
    hpPercent: 100,
    downed: false,
    position: { x: 2.3, z: -0.72 },
    ...overrides,
  };
}

function snapshot(party: (CompanionSnapshot | null)[]): SimulationSnapshot {
  return { party } as unknown as SimulationSnapshot;
}

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  drawn = [];
  const numbers = new DamageNumbers(scene);
  // NullEngine has no canvas, so the pool is inert; record the calls instead.
  const recording = {
    show: (hit: { damage: string }) => drawn.push(`damage:${hit.damage}`),
    callout: (_id: number, text: string) => drawn.push(`callout:${text}`),
  } as unknown as DamageNumbers;
  void numbers;
  presenter = new CompanionPresenter(scene, {
    enemyAnchor: () => new Vector3(3, 0.85, 0),
    numbers: recording,
  });
});

afterEach(() => {
  presenter.dispose();
  scene.dispose();
  engine.dispose();
});

function feed(events: GameEvent[], party = [member()]) {
  presenter.sync(snapshot(party), 0.016, events);
}

describe('companion combat is visible', () => {
  it('puts a number on the enemy a companion hits', () => {
    // Without this a companion swinging is a silent animation: the player sees
    // the party milling about and no evidence it is doing anything.
    feed([
      {
        type: 'companion_attack',
        time: 1,
        slot: 0,
        definitionId: 'hedge_warden',
        instanceId: 7,
        damage: '12.5',
        critical: false,
      },
    ]);
    expect(drawn).toContain('damage:12.5');
  });

  it('names the skill that fired', () => {
    feed([
      {
        type: 'companion_ability',
        time: 1,
        slot: 0,
        definitionId: 'hedge_warden',
        ability: 'mend',
        amount: '9',
        targets: [-1],
        hits: [],
      },
    ]);
    expect(drawn).toContain('callout:MEND');
  });

  it('numbers a damaging ability on what it landed on, and a supportive one not', () => {
    // Each enemy wears what it took, not the salvo's total: a 30-damage volley
    // split 18/12 read as 30 on both when the presenter painted `amount`.
    feed([
      {
        type: 'companion_ability',
        time: 1,
        slot: 0,
        definitionId: 'hedge_warden',
        ability: 'volley',
        amount: '30',
        targets: [7, 8],
        hits: [
          { instanceId: 7, damage: '18' },
          { instanceId: 8, damage: '12' },
        ],
      },
    ]);
    expect(drawn.filter((entry) => entry.startsWith('damage:'))).toEqual([
      'damage:18',
      'damage:12',
    ]);
    expect(drawn).toContain('callout:VOLLEY');

    drawn = [];
    feed([
      {
        type: 'companion_ability',
        time: 1,
        slot: 0,
        definitionId: 'hedge_warden',
        ability: 'rally',
        amount: '0.18',
        targets: [],
        hits: [],
      },
    ]);
    expect(drawn).toEqual(['callout:RALLY']);
  });

  it('shows what a companion took when it is hit', () => {
    feed([
      { type: 'companion_damaged', time: 1, slot: 0, instanceId: 7, damage: '6.25', absorbed: '0' },
    ]);
    expect(drawn).toContain('damage:6.25');
  });

  it('gives a debuff its name and no damage number', () => {
    // Hex and wither land on an enemy without hurting it, so the engine leaves
    // `hits` empty. Reading damage off `amount` instead stamped a 0 on them.
    for (const ability of ['hex', 'wither'] as const) {
      drawn = [];
      feed([
        {
          type: 'companion_ability',
          time: 1,
          slot: 0,
          definitionId: 'hedge_warden',
          ability,
          amount: '0',
          targets: [7],
          hits: [],
        },
      ]);
      expect(drawn).toEqual([`callout:${ability.toUpperCase()}`]);
    }
  });

  it('says BLOCK rather than a number when a shield ate the whole blow', () => {
    // Nothing came off the bar, so a damage number over an unmoving bar reads
    // as the fight being broken. The bulwark is the story of that hit.
    feed([
      { type: 'companion_damaged', time: 1, slot: 0, instanceId: 7, damage: '0', absorbed: '40' },
    ]);
    expect(drawn).toEqual(['callout:BLOCK']);
  });

  it('calls out a knockout and a revival', () => {
    feed([
      { type: 'companion_downed', time: 1, slot: 0, definitionId: 'hedge_warden' },
      { type: 'companion_revived', time: 2, slot: 0, definitionId: 'hedge_warden' },
    ]);
    expect(drawn).toEqual(['callout:DOWN', 'callout:UP']);
  });

  it('still reports damage from a companion it has no visual for yet', () => {
    /*
     * The number hangs on the enemy, not on the companion, and the engine only
     * emits this because the blow actually landed. A renderer that has not
     * caught up with the party yet must not swallow real feedback - it would
     * drop the first hit of every fight after a party change.
     */
    feed([
      {
        type: 'companion_attack',
        time: 1,
        slot: 4,
        definitionId: 'pale_herald',
        instanceId: 7,
        damage: '5',
        critical: false,
      },
    ]);
    expect(drawn).toEqual(['damage:5']);
  });

  it('does not invent a callout for a companion it cannot place', () => {
    // A callout hangs on the companion, so with nowhere to put it there is
    // nothing honest to draw.
    feed([
      {
        type: 'companion_ability',
        time: 1,
        slot: 4,
        definitionId: 'pale_herald',
        ability: 'revive',
        amount: '10',
        targets: [],
        hits: [],
      },
    ]);
    expect(drawn).toEqual([]);
  });
});

describe('party health bars', () => {
  it('gives no bar to a companion at full health', () => {
    // Five party bars plus the enemies' collide into an unreadable band, and a
    // full bar says nothing the shelf's party strip does not already.
    expect(presenter.healthBarTargets(snapshot([member()]))).toEqual([]);
  });

  it('shows a bar the moment one is hurt', () => {
    const hurt = member({ hpPercent: 61, hp: { raw: '24', display: '24' } });
    const bars = presenter.healthBarTargets(snapshot([hurt]));
    expect(bars).toHaveLength(1);
    expect(bars[0]).toMatchObject({ id: 0, hpPercent: 61, hp: '24', maxHp: '40', faded: false });
  });

  it('dims a downed companion rather than dropping it', () => {
    // Which of the five is out is exactly what a player needs to see.
    const down = member({ downed: true, hpPercent: 0, hp: { raw: '0', display: '0' } });
    const bars = presenter.healthBarTargets(snapshot([down]));
    expect(bars).toHaveLength(1);
    expect(bars[0]?.faded).toBe(true);
  });

  it('gives no bar to an empty slot', () => {
    expect(presenter.healthBarTargets(snapshot([null, null, null, null, null]))).toEqual([]);
  });
});

/**
 * The presenter reads the field through `enemyAnchor`, so it can only report a
 * blow against a target the scene has already placed. That makes the order of
 * the calls in `EvercastScene.sync` part of this class's contract rather than
 * an incidental detail of that method, and worth asserting somewhere it will
 * be read when someone rearranges them.
 */
describe("the scene's ordering contract", () => {
  const scene = readFileSync(join(process.cwd(), 'src/game/EvercastScene.ts'), 'utf8');

  it('places the enemies before letting the party react to hitting them', () => {
    const react = scene.indexOf('this.companions.sync(');
    const spawnAnchors = scene.indexOf('this.transientAnchors.set(');
    const visuals = scene.indexOf('this.syncEnemyVisuals(snapshot');
    expect(react).toBeGreaterThan(-1);

    // An enemy can spawn, be hit by a companion and die inside one publish.
    // Reacting first looked the target up before anything had placed it and
    // dropped the number without a trace.
    expect(react).toBeGreaterThan(spawnAnchors);
    expect(react).toBeGreaterThan(visuals);
  });
});
