import type { RunMode } from '../../engine/model';

// Prototype pacing: one successful stage grants one normal travel interval of visual world movement.
// Keep this centralized so it can be tuned with encounter pacing later.
export const WORLD_TRAVEL_SECONDS_PER_STAGE = 1.8;

export interface JourneyProgressInput {
  mode: RunMode;
  frontierStage: number;
  visualFrontierStage: number;
}

/**
 * Returns how many newly-earned frontier stages may move the visual world forward.
 * Farming and retrying an unbeaten frontier never earn world distance.
 */
export function earnedJourneyStages({ mode, frontierStage, visualFrontierStage }: JourneyProgressInput): number {
  if (mode !== 'push') return 0;
  return Math.max(0, frontierStage - visualFrontierStage);
}

export function initialJourneyTravelSeconds(frontierStage: number): number {
  return Math.max(0, frontierStage - 1) * WORLD_TRAVEL_SECONDS_PER_STAGE;
}
