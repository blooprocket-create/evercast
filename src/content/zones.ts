import type { ZoneDefinition } from './types';

/**
 * PLAYTEST defaults, not final balance.
 *
 * These sit on top of the per-stage growth an enemy already has, so they are
 * spikes rather than slope: a boss stage and a world-tier boundary each multiply
 * health in a single step. That is the point - they are meant to be the moments
 * a run has to stop and build - but both were set when player power was additive
 * and could not answer them at all, and a spike against a line is just a wall.
 *
 * Softened alongside the compounding gear curve, which is what now carries the
 * player across them. Measured at roughly a tenth of the improvement; the curve
 * itself carries the rest.
 */
export const BOSS_HEALTH_MULTIPLIER = 3;
export const BOSS_ATTACK_MULTIPLIER = 1.8;

/**
 * Applied once per full lap of the zone list, so the step lands in a single
 * stage - 101, 201, and so on. Health was 1.75, which meant one stage boundary
 * asked for three and a half stages' worth of growth at once.
 */
export const WORLD_TIER_HEALTH = 1.3;
export const WORLD_TIER_ATTACK = 1.15;

export const ZONES: readonly ZoneDefinition[] = [
  {
    id: 'greenfields',
    name: 'Greenfields',
    enemyIds: ['moss_slime', 'briarling', 'road_imp'],
    bossEnemyId: 'road_warden',
    environmentKey: 'zone/greenfields',
  },
  {
    id: 'whispering_woods',
    name: 'Whispering Woods',
    enemyIds: ['briarling', 'hollow_crow', 'road_imp'],
    bossEnemyId: 'road_warden',
    environmentKey: 'zone/whispering-woods',
  },
  {
    id: 'gravehollow',
    name: 'Gravehollow',
    enemyIds: ['crypt_hound', 'hollow_crow', 'ash_beetle'],
    bossEnemyId: 'road_warden',
    environmentKey: 'zone/gravehollow',
  },
  {
    id: 'ashen_road',
    name: 'Ashen Road',
    enemyIds: ['ember_wisp', 'ash_beetle', 'road_imp'],
    bossEnemyId: 'road_warden',
    environmentKey: 'zone/ashen-road',
  },
] as const;
