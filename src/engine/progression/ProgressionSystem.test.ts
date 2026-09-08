import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE_CONFIG } from '../config';
import type { EnemyState } from '../model';
import { big } from '../numbers';
import { createInitialGameState } from '../state';
import { firstClearEssenceReward } from './EssenceEconomy';
import { ProgressionSystem } from './ProgressionSystem';

function testEnemy(stage = 1): EnemyState {
  return {
    instanceId: 1,
    definitionId: 'test_enemy',
    name: 'Test Enemy',
    stage,
    boss: false,
    hp: big(0),
    maxHp: big(1),
    attackDamage: big(0),
    attackInterval: 10,
    attackCooldown: 10,
  };
}

describe('ProgressionSystem Essence economy', () => {
  it('awards Gold but no Essence for repeatable enemy kills', () => {
    const state = createInitialGameState(DEFAULT_ENGINE_CONFIG);
    const system = new ProgressionSystem(DEFAULT_ENGINE_CONFIG, () => undefined);

    system.handleEnemyKilled(state, testEnemy());

    expect(state.run.essence.toString()).toBe('0');
    expect(state.equipment.gold.cmp(0)).toBeGreaterThan(0);
  });

  it('awards Essence once when a new frontier stage is cleared', () => {
    const state = createInitialGameState(DEFAULT_ENGINE_CONFIG);
    const system = new ProgressionSystem(DEFAULT_ENGINE_CONFIG, () => undefined);

    system.handleEncounterCleared(state);

    expect(state.run.essence.toString()).toBe(firstClearEssenceReward(1, false).toString());
    expect(state.run.frontierStage).toBe(2);
    expect(state.meta.highestStageEver).toBe(2);
  });

  it('does not award Essence for farming or replaying an already-cleared frontier stage', () => {
    const state = createInitialGameState(DEFAULT_ENGINE_CONFIG);
    const system = new ProgressionSystem(DEFAULT_ENGINE_CONFIG, () => undefined);

    system.handleEncounterCleared(state);
    const earned = state.run.essence.toString();

    state.run.mode = 'farm';
    state.run.farmStage = 1;
    system.handleEncounterCleared(state);
    expect(state.run.essence.toString()).toBe(earned);

    // Simulate returning to an old frontier after a future reset/prestige.
    state.run.mode = 'push';
    state.run.frontierStage = 1;
    system.handleEncounterCleared(state);
    expect(state.run.essence.toString()).toBe(earned);
  });
});
