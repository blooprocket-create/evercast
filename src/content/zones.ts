import type { ZoneDefinition } from './types';

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
