import type { GearSlot } from '../gear/types';

export type GameEvent =
  | { type: 'encounter_started'; time: number; stage: number; totalEnemies: number; boss: boolean }
  | { type: 'enemy_spawned'; time: number; stage: number; instanceId: number; enemyId: string; enemyName: string; boss: boolean; spawned: number; total: number }
  | { type: 'spell_cast'; time: number; castId: number; projectiles: number }
  | { type: 'projectile_hit'; time: number; castId: number; projectileIndex: number; instanceId: number; damage: string; critical: boolean }
  | { type: 'enemy_attack'; time: number; instanceId: number; damage: string }
  | { type: 'enemy_killed'; time: number; stage: number; instanceId: number; enemyId: string; reward: string }
  | { type: 'mage_defeated'; time: number; stage: number }
  | { type: 'resource_gained'; time: number; resource: 'essence' | 'knowledge' | 'gold'; amount: string }
  | { type: 'stage_advanced'; time: number; stage: number }
  | { type: 'mode_changed'; time: number; mode: 'push' | 'farm'; reason: string }
  | { type: 'gear_leveled'; time: number; slot: GearSlot; level: number; cost: string }
  | { type: 'gear_evolved'; time: number; slot: GearSlot; level: number; evolutionTier: number; name: string }
  | { type: 'spell_point_purchased'; time: number; purchasedPoints: number; cost: string }
  | { type: 'spell_node_activated'; time: number; nodeId: string; nodeName: string }
  | { type: 'spell_tree_respecced'; time: number; refundedPoints: number }
  | { type: 'rebirth_performed'; time: number; knowledgeGained: string; rebirths: number };
