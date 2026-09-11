export interface EngineConfig {
  seed: number;
  travelSeconds: number;
  bossCadence: number;
  zoneLength: number;
  autoRetryFarmKills: number;
  maxEventsPerAdvance: number;
  maxOfflineSeconds: number;
  rebirthUnlockStage: number;
  baseMageHealth: number;
  enemySpawnInterval: number;
  maxAliveEnemies: number;
  maxNormalWaveEnemies: number;
  bossAddCount: number;
  /** Enemies approach down one of this many lanes. */
  laneCount: number;
  /** World-space gap between lane centres. */
  laneSpacing: number;
  /** How far out an enemy appears, in world units from the mage. */
  enemySpawnDistance: number;
  /** World units per second an enemy closes while it is out of range. */
  enemyApproachSpeed: number;
  /** How close an ordinary melee enemy comes before it can swing. Enemies that
   * fight at a distance carry their own reach in `src/content`. */
  enemyAttackRange: number;
  /** How long a swing is telegraphed before it lands. */
  enemyWindupSeconds: number;
  /** How far the Evercast reaches. Longer than melee, which is the point. */
  spellRange: number;
  /**
   * Extra distance a wave keeps when a front-row companion is standing as it
   * spawns. Without it there is no room in front of the mage for anyone, and
   * it has to clear the whole front rank: the furthest-forward slot sits at
   * x = 2.72, so a melee enemy resting at 1.1 + this stops well clear of it.
   */
  frontlineStandoff: number;
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  seed: 0x45564552, // "EVER"
  travelSeconds: 1.8,
  bossCadence: 10,
  zoneLength: 25,
  autoRetryFarmKills: 5,
  maxEventsPerAdvance: 250_000,
  maxOfflineSeconds: 60 * 60 * 24,
  rebirthUnlockStage: 50,
  baseMageHealth: 25,
  // Prototype combat-shape tuning. These are intentionally centralized.
  enemySpawnInterval: 0.85,
  maxAliveEnemies: 6,
  maxNormalWaveEnemies: 6,
  bossAddCount: 4,
  laneCount: 3,
  laneSpacing: 1.35,
  enemySpawnDistance: 13,
  enemyApproachSpeed: 2.4,
  enemyAttackRange: 1.1,
  enemyWindupSeconds: 0.3,
  spellRange: 9,
  frontlineStandoff: 2.3,
};
