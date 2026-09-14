import { DEFAULT_ENGINE_CONFIG } from '../../engine/config';
import type { RunMode } from '../../engine/model';

// Prototype pacing: one successful stage grants one normal travel interval of visual world movement.
// Keep this centralized so it can be tuned with encounter pacing later.
export const WORLD_TRAVEL_SECONDS_PER_STAGE = 1.8;

/**
 * How much road one zone of stages is worth, in world units.
 *
 * Ten chunks of twelve, which is what keeps a landmark landing on a chunk
 * boundary - and, more importantly, what lets the rendered biome and the zone
 * the HUD names be the same fact rather than two clocks left to drift.
 */
export const WORLD_UNITS_PER_ZONE = 120;

/**
 * Derived, not chosen. The world used to walk at a flat 2.6 units a second,
 * which made a zone of 25 stages 117 units of road against a biome cycle of
 * 120 - so the interface and the terrain agreed at the start of a run and
 * nowhere after it. This is the speed at which one zone of stages is exactly
 * one zone of road, whatever `zoneLength` is set to.
 */
export const WORLD_TRAVEL_SPEED =
  WORLD_UNITS_PER_ZONE / (DEFAULT_ENGINE_CONFIG.zoneLength * WORLD_TRAVEL_SECONDS_PER_STAGE);

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
