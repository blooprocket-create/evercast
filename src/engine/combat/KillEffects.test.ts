import { describe, expect, it } from 'vitest';
import { SPELL_TREE_NODE_BY_ID } from '../../content/spellTree';
import { DEFAULT_ENGINE_CONFIG } from '../config';
import { EvercastSimulation } from '../EvercastSimulation';
import type { GameEvent } from '../events/GameEvent';
import type { RunState } from '../model';
import { big } from '../numbers';
import { createInitialGameState } from '../state';
import { combatState } from './SpellCombatState';

/**
 * The on-kill hook lives in `EncounterLoop.collectDeadEnemies`, not in `cast`,
 * so these drive the real loop. What they prove is that a death is answered
 * however it happened - and that a burst which kills again is still this step's
 * work, not a corpse left lying for a later one to notice.
 */
function withApex(apexId: string) {
  const sim = new EvercastSimulation({
    initialState: createInitialGameState(DEFAULT_ENGINE_CONFIG),
  });
  sim.getState().spellTree.purchasedPoints = 80;
  sim.getState().spellTree.attunements = ['third_identity'];
  const activate = (id: string) => {
    if (id === 'evercast_root' || sim.getState().spellTree.activatedNodeIds.includes(id)) return;
    SPELL_TREE_NODE_BY_ID.get(id)!.requiresAll.forEach(activate);
    expect(sim.execute({ type: 'activate_spell_node', nodeId: id }), id).toBe(true);
  };
  activate(apexId);
  return sim;
}

/** Let a wave gather by keeping it alive, since this build clears one instantly. */
function gather(sim: EvercastSimulation, count: number): RunState {
  const run = sim.getState().run;
  // A run opens by travelling, so there is no encounter to widen yet.
  for (let step = 0; step < 200 && !run.encounter; step += 1) sim.advance(0.25);
  // A wave is as big as its stage, and stage one is a single enemy. Widen the
  // encounter rather than push far enough for the game to do it, so the test
  // stays about the kill hook.
  expect(run.encounter).toBeTruthy();
  run.encounter!.totalEnemies = count + 2;
  const immortal = () => {
    for (const enemy of run.enemies) {
      enemy.hp = big('1e9');
      enemy.maxHp = big('1e9');
      // Disarmed as well as unkillable: a wave this durable would otherwise
      // defeat the mage and the retry would clear the field we are building.
      enemy.attackDamage = big(0);
    }
  };
  for (let step = 0; step < 200 && run.enemies.length < count; step += 1) {
    immortal();
    sim.advance(0.25);
  }
  immortal();
  expect(run.enemies.length).toBeGreaterThanOrEqual(count);
  return run;
}

/**
 * The whole wave infected, but only the front one about to die of it. The rest
 * are left standing and not yet due to tick, so whatever answers that first
 * death finds them alive - if they all ticked at once there would be nothing
 * left for a burst to catch, and the test would pass for the wrong reason.
 */
function infectAndWeaken(run: RunState): void {
  run.enemies.forEach((enemy, index) => {
    enemy.statuses = {
      dot: {
        baseDamage: '1000',
        damage: '1000',
        nextTickAt: run.elapsedSeconds + (index === 0 ? 0.1 : 20),
        expiresAt: run.elapsedSeconds + 60,
        castId: 1,
        sourceInstanceId: enemy.instanceId,
        mechanics: { ...run.spell.mechanics! },
      },
    };
    enemy.hp = index === 0 ? big(1) : big(100);
    // A wave held mid-approach is strung out over more than a burst radius.
    // Stand them close so the question under test is whether the burst happens,
    // not whether anyone was near enough to catch it. The approach anchor moves
    // with them, or the next step recomputes x and pulls them apart again.
    const x = 3 + index * 0.8;
    enemy.position = { x, z: 0 };
    enemy.approachFrom = x;
    enemy.approachSince = run.elapsedSeconds;
  });
  // Push the cast out of the way, so the infection is unambiguously the killer.
  run.castCooldown = 999;
}

const drained = (sim: EvercastSimulation): GameEvent[] => sim.drainPresentationEvents();

describe('answering a death', () => {
  it('bursts a host the infection itself killed, not only one a cast killed', () => {
    const sim = withApex('necrosis');
    const run = gather(sim, 3);
    infectAndWeaken(run);
    const before = run.stats.kills;
    drained(sim);

    sim.advance(1);

    expect(drained(sim).some((e) => e.type === 'effect_hit' && e.effect === 'necrosis')).toBe(true);
    expect(run.stats.kills).toBeGreaterThan(before);
  });

  it('collects every body a cascade makes in the same step, and pays for each', () => {
    const sim = withApex('necrosis');
    const state = sim.getState();
    const run = gather(sim, 3);
    infectAndWeaken(run);
    const standing = run.enemies.length;
    const killsBefore = run.stats.kills;
    const goldBefore = state.equipment.gold;
    drained(sim);

    sim.advance(1);

    // Nothing is left lying at zero waiting for a later step to notice it.
    expect(run.enemies.every((enemy) => enemy.hp.cmp(0) > 0)).toBe(true);
    expect(run.stats.kills - killsBefore).toBeGreaterThanOrEqual(standing);
    expect(state.equipment.gold.cmp(goldBefore)).toBeGreaterThan(0);
  });

  it('leaves a build that took the other capstone exactly as it was', () => {
    const sim = withApex('pandemic');
    const run = gather(sim, 3);
    infectAndWeaken(run);
    drained(sim);

    sim.advance(1);

    expect(drained(sim).some((e) => e.type === 'effect_hit' && e.effect === 'necrosis')).toBe(false);
    expect(run.stats.kills).toBeGreaterThan(0);
  });

  it('carries Momentum out of a kill under Cascade', () => {
    const sim = withApex('cascade');
    const run = gather(sim, 3);
    expect(run.spell.mechanics?.cascade).toBe(true);
    infectAndWeaken(run);
    const runtime = combatState(run);
    runtime.momentum = 0;
    runtime.momentumUntil = 0;
    runtime.overdriveUntil = 0;

    sim.advance(1);

    // The kill paid, not the penetration: no cast went out at all.
    expect(run.stats.kills).toBeGreaterThan(0);
    expect(runtime.momentum + runtime.overdriveUntil).toBeGreaterThan(0);
  });
});
