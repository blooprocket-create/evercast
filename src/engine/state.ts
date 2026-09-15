import { createCounterspellState } from './combat/Surge';
import type { EngineConfig } from './config';
import { createInitialCompanionsState } from './companions/CompanionSystem';
import { createInitialEquipmentState } from './gear/GearSystem';
import type { GameState, MetaState, RunState } from './model';
import { big } from './numbers';
import { createDefaultSpellBuild } from './spell/SpellCompiler';
import { createInitialSpellTreeState } from './spellTree/SpellTreeSystem';

export function createInitialRunState(config: EngineConfig): RunState {
  return {
    counter: createCounterspellState(),
    companions: [],
    benchedCompanions: [],
    elapsedSeconds: 0,
    frontierStage: 1,
    highestStageThisRun: 1,
    encounterStage: 1,
    zoneNumber: 1,
    zoneName: 'Greenfields',
    mode: 'push',
    farmStage: 1,
    farmKillsSinceFailure: 0,
    phase: 'travel',
    travelElapsed: 0,
    castCooldown: 0,
    essence: big(0),
    mage: {
      hp: big(config.baseMageHealth),
      maxHp: big(config.baseMageHealth),
    },
    enemies: [],
    encounter: null,
    nextEnemyInstanceId: 1,
    spell: createDefaultSpellBuild(),
    stats: {
      casts: 0,
      projectileHits: 0,
      criticalHits: 0,
      kills: 0,
      deaths: 0,
      bossKills: 0,
    },
  };
}

export function createInitialMetaState(): MetaState {
  return {
    rebirths: 0,
    knowledge: big(0),
    lifetimeKnowledge: big(0),
    highestStageEver: 1,
    lifetimeKills: 0,
    storyFlags: [],
    unlockedSystems: [],
  };
}

export function createInitialGameState(config: EngineConfig): GameState {
  return {
    run: createInitialRunState(config),
    meta: createInitialMetaState(),
    equipment: createInitialEquipmentState(),
    spellTree: createInitialSpellTreeState(),
    companions: createInitialCompanionsState(),
  };
}
