export type GameEvent =
  | { type: 'encounter_started'; time: number; stage: number; enemyId: string; enemyName: string; boss: boolean }
  | { type: 'spell_cast'; time: number; castId: number; projectiles: number }
  | { type: 'projectile_hit'; time: number; castId: number; projectileIndex: number; damage: string; critical: boolean }
  | { type: 'enemy_attack'; time: number; damage: string }
  | { type: 'enemy_killed'; time: number; stage: number; enemyId: string; reward: string }
  | { type: 'mage_defeated'; time: number; stage: number }
  | { type: 'resource_gained'; time: number; resource: 'essence' | 'knowledge'; amount: string }
  | { type: 'stage_advanced'; time: number; stage: number }
  | { type: 'mode_changed'; time: number; mode: 'push' | 'farm'; reason: string }
  | { type: 'rebirth_performed'; time: number; knowledgeGained: string; rebirths: number };
