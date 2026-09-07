export type CombatPhase = 'travel' | 'combat' | 'boss';

export interface SimulationSnapshot {
  elapsedSeconds: number;
  stage: number;
  zone: number;
  essence: number;
  mageHp: number;
  mageMaxHp: number;
  enemyHp: number;
  enemyMaxHp: number;
  enemyName: string;
  phase: CombatPhase;
  casts: number;
  kills: number;
  projectilesPerCast: number;
  damagePerProjectile: number;
  castInterval: number;
  progressToNextEncounter: number;
  lastEvent: string;
}
