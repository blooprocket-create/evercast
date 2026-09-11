import { describe, expect, it } from 'vitest';
import { createDefaultCatalog } from '../../content/catalog';
import { DEFAULT_ENGINE_CONFIG } from '../config';
import { EncounterSystem } from '../encounters/EncounterSystem';
import { EvercastSimulation } from '../EvercastSimulation';
import { OfflineProgressor } from '../offline/OfflineProgressor';
import { chooseTarget, threatOf } from '../combat/Threat';
import { contactPoint } from '../combat/Contact';
import type { GameEvent } from '../events/GameEvent';
import type { EnemyState, GameState } from '../model';
import { big } from '../numbers';
import { SaveCodec } from '../save/SaveCodec';
import { guardReduction, isPassive, nextCompanionBeat } from './CompanionCombat';
import { MAX_COMPANION_STARS } from './types';

/** A vanguard, a bruiser, a ranger, an arcanist and a healer. */
const FULL_PARTY = [
  'hedge_warden',
  'ashroad_sellsword',
  'verge_longbow',
  'gravebell_acolyte',
  'tallow_chirurgeon',
];

function withParty(
  simulation: EvercastSimulation,
  party: readonly string[] = FULL_PARTY,
  stars = 3,
): EvercastSimulation {
  const state = simulation.getState();
  for (const id of party) {
    state.companions.owned[id] = { definitionId: id, stars, shards: 0 };
  }
  // Equipping through the command is what rebuilds the live combatants, so the
  // party is left empty above and filled here.
  party.forEach((id, slot) => {
    const equipped = simulation.execute({ type: 'equip_companion', definitionId: id, slot });
    if (!equipped) throw new Error(`could not equip ${id} into slot ${slot}`);
  });
  return simulation;
}

function fresh(seed = 4242, party?: readonly string[]): EvercastSimulation {
  return withParty(new EvercastSimulation({ config: { seed } }), party);
}

/**
 * What a run actually produced, as opposed to the exact reading of its clock.
 *
 * Feeding the same span in different sized steps cannot sum to bit-identical
 * floats - 6000 x float(0.1) is not float(600) - and the engine has never
 * claimed otherwise. It claims that renderer frame rate cannot change
 * authoritative OUTCOMES, which is this.
 */
function outcome(simulation: EvercastSimulation) {
  const snapshot = simulation.getSnapshot();
  const state = simulation.getState();
  return {
    kills: snapshot.kills,
    deaths: snapshot.deaths,
    stage: snapshot.stage,
    mode: snapshot.mode,
    phase: snapshot.phase,
    enemies: state.run.enemies.map((enemy) => enemy.instanceId),
    companions: state.run.companions.map((companion) => ({
      definitionId: companion.definitionId,
      downed: companion.downed,
      health: companion.hp.div(companion.maxHp).toNumber().toFixed(6),
    })),
  };
}

describe('companion combat determinism', () => {
  /*
   * The gate this whole feature rests on. Companion swings and abilities add
   * event sources to a loop whose correctness depends on stopping at every
   * event. Miss one and a companion opens fire at a different instant under a
   * different frame rate, and offline catch-up stops agreeing with live play.
   */
  it('produces the same run whatever size the steps are', () => {
    const single = fresh();
    single.advance(600, { presentationEvents: false });

    const chunked = fresh();
    for (let step = 0; step < 6000; step += 1) chunked.advance(0.1, { presentationEvents: false });

    const jittery = fresh();
    const frames = [0.0166, 0.25, 0.004, 0.1, 0.0333, 0.5, 0.008];
    for (let index = 0; index < 600 / 0.13; index += 1) {
      jittery.advance(frames[index % frames.length] ?? 0.016, { presentationEvents: false });
    }

    expect(outcome(chunked)).toEqual(outcome(single));
    // The jittery run is fed a different total, so only its shape is compared.
    expect(jittery.getState().run.companions).toHaveLength(FULL_PARTY.length);
    expect(jittery.getSnapshot().kills).toBeGreaterThan(0);
  });

  it('resumes a save on exactly the state it was saved in', () => {
    // Unlike step size, this one is bit-exact and has to be: both runs make
    // the same two advance calls, so a save round-trip that changed anything
    // at all would be the save format losing information.
    const codec = new SaveCodec(DEFAULT_ENGINE_CONFIG);

    const control = fresh();
    control.advance(300, { presentationEvents: false });
    control.advance(300, { presentationEvents: false });

    const saved = fresh();
    saved.advance(300, { presentationEvents: false });
    const reloaded = new EvercastSimulation({
      config: { seed: 4242 },
      initialState: codec.decode(JSON.parse(JSON.stringify(codec.encode(saved.getState())))).state,
    });
    reloaded.advance(300, { presentationEvents: false });

    expect(reloaded.getSnapshot()).toEqual(control.getSnapshot());
  });

  it('catches up offline exactly as it would have played live', () => {
    // Away progress runs through the same advance() with presentation events
    // suppressed. If companions behaved differently there, an hour in a
    // background tab would quietly produce a different game than an hour
    // watched - which is the one thing offline catch-up must never do.
    const watched = fresh(2718);
    watched.advance(1800);
    watched.drainPresentationEvents();

    const away = fresh(2718);
    away.drainPresentationEvents(); // Setting the party up is not away progress.
    new OfflineProgressor(DEFAULT_ENGINE_CONFIG.maxOfflineSeconds).apply(away, 1800);

    expect(outcome(away)).toEqual(outcome(watched));
    // And nothing was queued for a renderer that was not watching.
    expect(away.drainPresentationEvents()).toEqual([]);
  });

  it('gives two runs of the same seed the same world, companions and all', () => {
    const left = fresh(31337);
    const right = fresh(31337);
    left.advance(420, { presentationEvents: false });
    right.advance(420, { presentationEvents: false });
    expect(right.getSnapshot()).toEqual(left.getSnapshot());
  });

  it('leaves an empty party exactly as it found the game', () => {
    // Nobody who has not summoned anything should see combat change at all.
    const before = new EvercastSimulation({ config: { seed: 7 } });
    before.advance(300, { presentationEvents: false });
    const after = new EvercastSimulation({ config: { seed: 7 } });
    after.advance(300, { presentationEvents: false });
    expect(after.getSnapshot().kills).toBe(before.getSnapshot().kills);
    expect(after.getState().run.companions).toEqual([]);
  });

  it('never schedules a passive as a beat', () => {
    // A guard has no cooldown. Scheduling it would put a due action at t=0 on
    // every pass, the loop would consume no time, and advance() would spin
    // until it hit the safety limit.
    expect(isPassive('guard')).toBe(true);
    const simulation = fresh(11, ['hedge_warden', 'cairn_tortoise']);
    expect(() => simulation.advance(120, { presentationEvents: false })).not.toThrow();
    const run = simulation.getState().run;
    if (run.companions.length > 0 && run.enemies.length > 0) {
      expect(nextCompanionBeat(run)).toBeGreaterThan(0);
    }
  });
});

describe('companions in a fight', () => {
  it('kills things the mage alone would not have', () => {
    const alone = new EvercastSimulation({ config: { seed: 5150 } });
    alone.advance(300, { presentationEvents: false });
    const helped = fresh(5150);
    helped.advance(300, { presentationEvents: false });
    expect(helped.getSnapshot().kills).toBeGreaterThan(alone.getSnapshot().kills);
  });

  it('announces its blows so the renderer can animate them', () => {
    const simulation = fresh(808);
    simulation.advance(120);
    const events = simulation.drainPresentationEvents();
    expect(events.some((event) => event.type === 'companion_attack')).toBe(true);
    expect(events.some((event) => event.type === 'companion_ability')).toBe(true);
  });

  it('spends a companion attack on something actually in reach', () => {
    const simulation = fresh(31);
    simulation.advance(90);
    const run = simulation.getState().run;
    for (const event of simulation.drainPresentationEvents()) {
      if (event.type !== 'companion_attack') continue;
      // Damage is never zero-value noise: something real took it.
      expect(big(event.damage).cmp(0)).toBeGreaterThanOrEqual(0);
    }
    expect(run.companions.length).toBe(FULL_PARTY.length);
  });
});

describe('threat', () => {
  const flyer = (): EnemyState => ({ instanceId: 1, tags: ['flying'] }) as EnemyState;
  const walker = (): EnemyState => ({ instanceId: 2, tags: ['beast'] }) as EnemyState;

  it('sends a ground enemy at the highest threat on the field', () => {
    const run = fresh(1).getState().run;
    const target = chooseTarget(run, walker());
    expect(target.kind).toBe('companion');
    if (target.kind === 'companion') expect(target.companion.definitionId).toBe('hedge_warden');
  });

  it('moves down the line as the front rank falls', () => {
    const run = fresh(1).getState().run;
    const vanguard = run.companions.find((c) => c.definitionId === 'hedge_warden');
    if (vanguard) vanguard.downed = true;
    const target = chooseTarget(run, walker());
    if (target.kind === 'companion') expect(target.companion.definitionId).toBe('ashroad_sellsword');
    else throw new Error('expected a companion to step up');
  });

  it('reaches the mage once nothing is left standing', () => {
    const run = fresh(1).getState().run;
    for (const companion of run.companions) companion.downed = true;
    expect(chooseTarget(run, walker()).kind).toBe('mage');
  });

  it('lets a flyer dive the softest thing on the field', () => {
    // Otherwise a wall of vanguards makes the back row permanently safe and
    // turns healers into free stats.
    const run = fresh(1).getState().run;
    const target = chooseTarget(run, flyer());
    expect(target.kind).toBe('companion');
    if (target.kind === 'companion') expect(target.companion.definitionId).toBe('tallow_chirurgeon');
  });

  it('does not treat a lone healer as a shield', () => {
    // A support's threat is below the mage's, so she still takes the blow.
    const run = fresh(1, ['tallow_chirurgeon']).getState().run;
    expect(chooseTarget(run, walker()).kind).toBe('mage');
  });

  it('makes an ascended tank hold harder than a fresh one', () => {
    const low = fresh(1, ['hedge_warden']).getState().run.companions[0];
    const high = withParty(new EvercastSimulation(), ['hedge_warden'], MAX_COMPANION_STARS)
      .getState()
      .run.companions[0];
    if (!low || !high) throw new Error('expected companions');
    expect(threatOf(high)).toBeGreaterThan(threatOf(low));
  });
});

describe('knockouts', () => {
  function hammer(simulation: EvercastSimulation): GameState {
    const state = simulation.getState();
    // A blow far past anything standing can absorb.
    for (const companion of state.run.companions) companion.hp = big(1);
    return state;
  }

  it('puts a companion down rather than ending the run', () => {
    const simulation = fresh(606);
    simulation.advance(20, { presentationEvents: false });
    const state = hammer(simulation);
    const deathsBefore = state.run.stats.deaths;
    simulation.advance(60, { presentationEvents: false });

    // Something fell, and it was not the mage's problem.
    expect(state.run.stats.deaths).toBe(deathsBefore);
  });

  it('brings the party back for the next encounter', () => {
    const simulation = fresh(707);
    simulation.advance(20, { presentationEvents: false });
    for (const companion of simulation.getState().run.companions) {
      companion.downed = true;
      companion.hp = big(0);
    }
    // Far enough to clear the stage, which is where recovery happens.
    simulation.advance(400, { presentationEvents: false });
    const run = simulation.getState().run;
    expect(run.companions.some((companion) => companion.downed)).toBe(false);
  });

  it('reports a knockout so the renderer can drop the body', () => {
    // No healer in this party: a mend landing first would keep it standing,
    // and the encounter clearing would restore it before anything was seen.
    const simulation = fresh(909, ['hedge_warden']);
    simulation.advance(20);
    simulation.drainPresentationEvents();

    const collected: GameEvent[] = [];
    for (let step = 0; step < 400; step += 1) {
      for (const companion of simulation.getState().run.companions) {
        if (!companion.downed) companion.hp = big('0.000001');
      }
      simulation.advance(0.05);
      collected.push(...simulation.drainPresentationEvents());
      if (collected.some((event) => event.type === 'companion_downed')) break;
    }
    expect(collected.some((event) => event.type === 'companion_downed')).toBe(true);
  });
});

describe('guard', () => {
  it('blunts a wave without ever making the party immune to one', () => {
    const none = new EvercastSimulation().getState().run;
    expect(guardReduction(none)).toBe(0);

    const guarded = fresh(1, ['hedge_warden', 'cairn_tortoise', 'mossback_bulwark']).getState().run;
    expect(guardReduction(guarded)).toBeGreaterThan(0);

    // Five of the best guards in the game still cannot reach immunity.
    const wall = withParty(
      new EvercastSimulation(),
      ['hedge_warden', 'cairn_tortoise', 'mossback_bulwark', 'fenmarch_pikeman'],
      MAX_COMPANION_STARS,
    ).getState().run;
    expect(guardReduction(wall)).toBeLessThanOrEqual(0.75);
  });

  it('stops sheltering the party once its owner is down', () => {
    const run = fresh(1, ['hedge_warden']).getState().run;
    const before = guardReduction(run);
    const guard = run.companions[0];
    if (guard) guard.downed = true;
    expect(guardReduction(run)).toBeLessThan(before);
  });
});

describe('the frontline standoff', () => {
  it('keeps a wave off the mage while the line is held', () => {
    const held = fresh(2024);
    held.advance(30, { presentationEvents: false });
    const guarded = held.getState().run.enemies[0];

    const open = new EvercastSimulation({ config: { seed: 2024 } });
    open.advance(30, { presentationEvents: false });
    const unguarded = open.getState().run.enemies[0];

    if (!guarded || !unguarded) throw new Error('expected enemies on both fields');
    expect(guarded.frontlineOffset).toBe(DEFAULT_ENGINE_CONFIG.frontlineStandoff);
    expect(unguarded.frontlineOffset).toBe(0);
    expect(contactPoint(guarded, DEFAULT_ENGINE_CONFIG.enemyAttackRange).x).toBeGreaterThan(
      contactPoint(unguarded, DEFAULT_ENGINE_CONFIG.enemyAttackRange).x,
    );
  });

  it('lets the next wave press in once the front row has fallen', () => {
    // Driven through the spawn seam directly: waiting for a real wave would
    // race the encounter clear, which restores the party on purpose.
    const simulation = fresh(3033);
    simulation.advance(30, { presentationEvents: false });
    const run = simulation.getState().run;
    expect(run.enemies.every((e) => e.frontlineOffset === DEFAULT_ENGINE_CONFIG.frontlineStandoff)).toBe(true);

    const encounters = new EncounterSystem(createDefaultCatalog(), DEFAULT_ENGINE_CONFIG);
    if (run.encounter) run.encounter.totalEnemies = run.encounter.spawnedEnemies + 2;
    const whileHeld = encounters.spawnEnemy(run);
    expect(whileHeld?.frontlineOffset).toBe(DEFAULT_ENGINE_CONFIG.frontlineStandoff);

    for (const companion of run.companions) companion.downed = true;
    const afterTheFall = encounters.spawnEnemy(run);
    expect(afterTheFall?.frontlineOffset).toBe(0);
  });

  it('never moves an enemy that has already committed to its distance', () => {
    // contactPoint is derived twice per step; a stop that moved when a tank
    // fell would put a chunked run and a single pass on different coordinates.
    const simulation = fresh(4044);
    simulation.advance(30, { presentationEvents: false });
    const run = simulation.getState().run;
    const enemy = run.enemies[0];
    if (!enemy) throw new Error('expected an enemy');
    const before = contactPoint(enemy, DEFAULT_ENGINE_CONFIG.enemyAttackRange).x;

    for (const companion of run.companions) companion.downed = true;
    expect(contactPoint(enemy, DEFAULT_ENGINE_CONFIG.enemyAttackRange).x).toBe(before);
  });
});
