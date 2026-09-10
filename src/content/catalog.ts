import { ENEMIES } from './enemies';
import type { ContentCatalog, EnemyDefinition, ZoneDefinition } from './types';
import { ZONES } from './zones';

export function createDefaultCatalog(): ContentCatalog {
  return {
    enemies: new Map(ENEMIES.map((enemy) => [enemy.id, enemy])),
    zones: ZONES,
  };
}

export interface ResolvedZone {
  zone: ZoneDefinition;
  zoneNumber: number;
  worldTier: number;
  localStage: number;
}

export function resolveZone(
  catalog: ContentCatalog,
  stage: number,
  zoneLength: number,
): ResolvedZone {
  const zeroBasedZoneNumber = Math.floor((Math.max(1, stage) - 1) / zoneLength);
  const zone = catalog.zones[zeroBasedZoneNumber % catalog.zones.length];
  if (!zone) throw new Error('Content catalog has no zones.');

  return {
    zone,
    zoneNumber: zeroBasedZoneNumber + 1,
    worldTier: Math.floor(zeroBasedZoneNumber / catalog.zones.length),
    localStage: ((Math.max(1, stage) - 1) % zoneLength) + 1,
  };
}

export function requireEnemy(catalog: ContentCatalog, id: string): EnemyDefinition {
  const enemy = catalog.enemies.get(id);
  if (!enemy) throw new Error(`Unknown enemy definition: ${id}`);
  return enemy;
}

export function validateCatalog(catalog: ContentCatalog): string[] {
  const errors: string[] = [];
  if (catalog.zones.length === 0) errors.push('At least one zone is required.');
  if (catalog.enemies.size === 0) errors.push('At least one enemy is required.');

  for (const enemy of catalog.enemies.values()) {
    if (enemy.attackRange !== undefined && !(enemy.attackRange > 0)) {
      errors.push(`Enemy ${enemy.id} has a non-positive attackRange.`);
    }
  }

  for (const zone of catalog.zones) {
    if (zone.enemyIds.length === 0) errors.push(`Zone ${zone.id} has no enemies.`);
    for (const enemyId of [...zone.enemyIds, zone.bossEnemyId]) {
      if (!catalog.enemies.has(enemyId)) {
        errors.push(`Zone ${zone.id} references missing enemy ${enemyId}.`);
      }
    }
  }
  return errors;
}
