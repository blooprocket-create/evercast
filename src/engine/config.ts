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
};
