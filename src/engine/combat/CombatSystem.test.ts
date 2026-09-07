import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE_CONFIG } from '../config';
import { big } from '../numbers';
import { createInitialGameState } from '../state';
import { CombatSystem } from './CombatSystem';

describe('CombatSystem', () => {
  it('heals leech from actual damage dealt instead of overkill damage', () => {
    const state = createInitialGameState(DEFAULT_ENGINE_CONFIG);
    state.run.mage.hp = big(1);
    state.run.mage.maxHp = big(100);
    state.run.spell.baseDamage = '1000';
    state.run.spell.critChance = 0;
    state.run.spell.modifiers = [
      { id: 'test_leech', kind: 'combat', action: { kind: 'leech', fraction: 0.1 } },
    ];
    state.run.enemies = [{
      instanceId: 1,
      definitionId: 'test_target',
      name: '1 HP Target',
      stage: 1,
      boss: false,
      hp: big(1),
      maxHp: big(1),
      attackDamage: big(0),
      attackInterval: 1,
      attackCooldown: 1,
      reward: big(0),
    }];

    const combat = new CombatSystem(DEFAULT_ENGINE_CONFIG, () => {});
    combat.cast(state.run, state.equipment);

    expect(state.run.enemies[0].hp.toNumber()).toBe(0);
    expect(state.run.mage.hp.toNumber()).toBeCloseTo(1.1);
  });
});
