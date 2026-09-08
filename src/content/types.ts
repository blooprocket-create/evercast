export interface EnemyDefinition {
  id: string;
  name: string;
  baseHealth: string;
  healthGrowth: number;
  baseAttack: string;
  attackGrowth: number;
  attackInterval: number;
  modelKey: string;
  tags: string[];
}

export interface ZoneDefinition {
  id: string;
  name: string;
  enemyIds: string[];
  bossEnemyId: string;
  environmentKey: string;
}

export interface ContentCatalog {
  enemies: ReadonlyMap<string, EnemyDefinition>;
  zones: readonly ZoneDefinition[];
}
