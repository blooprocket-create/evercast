import { describe, expect, it } from 'vitest';
import { NO_MASTERY } from '../prestige/Mastery';
import { DEFAULT_ENGINE_CONFIG } from '../config';
import type { GameEvent } from '../events/GameEvent';
import { big } from '../numbers';
import { createInitialGameState } from '../state';
import { CombatSystem } from './CombatSystem';

describe('CombatSystem', () => {
  it('reports only actual capped healing and control applied to surviving targets',()=>{
    const state=createInitialGameState(DEFAULT_ENGINE_CONFIG),events:GameEvent[]=[];
    state.run.mage.hp=big(99.95);state.run.mage.maxHp=big(100);
    state.run.spell={baseDamage:'1',castInterval:1,projectileCount:1,critChance:0,critMultiplier:2,modifiers:[
      {id:'leech',kind:'combat',action:{kind:'leech',fraction:1}},
      {id:'control',kind:'combat',action:{kind:'control',delaySeconds:.25}},
    ]};
    state.run.enemies=[{instanceId:1,definitionId:'target',name:'target',stage:1,boss:false,hp:big(100),maxHp:big(100),attackDamage:big(0),attackInterval:1,attackCooldown:1}];
    const combat=new CombatSystem(DEFAULT_ENGINE_CONFIG,e=>events.push(e));
    combat.cast(state.run, state.equipment, NO_MASTERY);
    let hit=events.find(e=>e.type==='projectile_hit')!;
    expect(Number(hit.healing)).toBeCloseTo(.05);expect(hit.controlDelaySeconds).toBe(.25);
    expect(state.run.enemies[0].attackCooldown).toBe(1.25);
    events.length=0;combat.cast(state.run, state.equipment, NO_MASTERY);
    hit=events.find(e=>e.type==='projectile_hit')!;expect(hit.healing).toBe('0');
    state.run.enemies[0].hp=big(1);events.length=0;combat.cast(state.run, state.equipment, NO_MASTERY);
    hit=events.find(e=>e.type==='projectile_hit')!;expect(hit.controlDelaySeconds).toBe(0);
    expect(state.run.enemies[0].attackCooldown).toBe(1.5);
  });
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
    }];

    const events: GameEvent[]=[];
    const combat = new CombatSystem(DEFAULT_ENGINE_CONFIG, e=>events.push(e));
    combat.cast(state.run, state.equipment, NO_MASTERY);

    expect(state.run.enemies[0].hp.toNumber()).toBe(0);
    expect(state.run.mage.hp.toNumber()).toBeCloseTo(1.1);
    const hit=events.find(e=>e.type==='projectile_hit');
    expect(Number(hit?.healing)).toBeCloseTo(.1);
    expect(hit?.controlDelaySeconds).toBe(0);
  });

  it('emits enough provenance for presentation to distinguish direct, pierce, chain and splash hits', () => {
    const state = createInitialGameState(DEFAULT_ENGINE_CONFIG);
    state.run.spell.baseDamage = '1';
    state.run.spell.critChance = 0;
    state.run.spell.projectileCount = 1;
    state.run.spell.modifiers = [
      { id: 'pierce', kind: 'combat', action: { kind: 'pierce', count: 1 } },
      { id: 'chain', kind: 'combat', action: { kind: 'chain', count: 2, damageMultiplier: 0.5 } },
      { id: 'splash', kind: 'combat', action: { kind: 'splash', targets: 1, damageMultiplier: 0.25 } },
    ];
    state.run.enemies = [1, 2, 3, 4, 5].map((instanceId) => ({
      instanceId,
      definitionId: `target_${instanceId}`,
      name: `Target ${instanceId}`,
      stage: 1,
      boss: false,
      hp: big(100),
      maxHp: big(100),
      attackDamage: big(0),
      attackInterval: 10,
      attackCooldown: 10,
    }));

    const events: GameEvent[] = [];
    const combat = new CombatSystem(DEFAULT_ENGINE_CONFIG, (event) => events.push(event));
    combat.cast(state.run, state.equipment, NO_MASTERY);

    const hits = events.filter((event): event is Extract<GameEvent, { type: 'projectile_hit' }> => event.type === 'projectile_hit');
    expect(hits.map((event) => event.source)).toEqual(['direct', 'pierce', 'chain', 'chain', 'splash']);
    expect(hits[1].sourceInstanceId).toBe(1);
    expect(hits[2].sourceInstanceId).toBe(1);
    expect(hits[3].sourceInstanceId).toBe(3);
    expect(hits[4].sourceInstanceId).toBe(1);
    expect(hits.map((event) => event.sequence)).toEqual([0, 1, 1, 2, 1]);
  });
});
