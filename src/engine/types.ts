import type { QuantitySnapshot } from './numbers';
import type { RunMode } from './model';

export interface SimulationSnapshot {
  elapsedSeconds: number;
  stage: number;
  encounterStage: number;
  zone: number;
  zoneName: string;
  mode: RunMode;
  farmStage: number;
  farmKillsSinceFailure: number;
  essence: QuantitySnapshot;
  knowledge: QuantitySnapshot;
  mageHp: QuantitySnapshot;
  mageMaxHp: QuantitySnapshot;
  mageHpPercent: number;
  enemyHp: QuantitySnapshot;
  enemyMaxHp: QuantitySnapshot;
  enemyHpPercent: number;
  enemyName: string;
  phase: 'travel' | 'combat';
  boss: boolean;
  casts: number;
  kills: number;
  deaths: number;
  projectileCount: number;
  damagePerProjectile: QuantitySnapshot;
  castInterval: number;
  progressToNextEncounter: number;
  highestStageEver: number;
  rebirths: number;
  canRebirth: boolean;
  lastEvent: string;
}

export type EngineCommand =
  | { type: 'retry_frontier' }
  | { type: 'set_spell_build'; build: import('./spell/types').SpellBuild }
  | { type: 'rebirth' };
