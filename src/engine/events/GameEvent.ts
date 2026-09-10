import type { GearSlot } from '../gear/types';
import type { CombatPosition } from '../combat/SpellCombatState';

export type ProjectileHitSource = 'direct' | 'pierce' | 'chain' | 'splash' | 'repeat';

export type GameEvent =
  | { type: 'encounter_started'; time: number; stage: number; totalEnemies: number; boss: boolean }
  | {
      type: 'enemy_spawned';
      time: number;
      stage: number;
      instanceId: number;
      enemyId: string;
      enemyName: string;
      boss: boolean;
      spawned: number;
      total: number;
      position?: CombatPosition;
    }
  | {
      type: 'spell_cast';
      time: number;
      castId: number;
      projectiles: number;
      route?: 'base' | 'twin' | 'piercing' | 'charged';
      powerScale?: number;
      overdrive?: boolean;
      perfect?: boolean;
    }
  | {
      type: 'meteor_queued';
      time: number;
      effectId: number;
      castId: number;
      instanceId: number;
      position: CombatPosition;
      dueAt: number;
      infect: boolean;
    }
  | {
      type: 'effect_hit';
      time: number;
      effectId: number;
      castId: number;
      instanceId: number;
      sourceInstanceId: number;
      damage: string;
      effect: 'explosion' | 'meteor' | 'dot';
      position: CombatPosition;
      empowered?: boolean;
    }
  | {
      type: 'status_applied';
      time: number;
      instanceId: number;
      sourceInstanceId: number;
      status: 'dot' | 'weakness' | 'ruin';
      stacks: number;
      expiresAt: number;
      spread?: boolean;
    }
  | {
      type: 'combat_state';
      time: number;
      state: 'momentum' | 'overdrive' | 'focus' | 'supercharge' | 'velocity';
      stacks: number;
      expiresAt?: number;
    }
  | {
      type: 'projectile_hit';
      time: number;
      castId: number;
      projectileIndex: number;
      instanceId: number;
      damage: string;
      critical: boolean;
      source: ProjectileHitSource;
      sourceInstanceId?: number;
      sequence: number;
      /** Actual health restored (after max-HP clamp), for presentation only. */
      healing?: string;
      /** Attack delay actually applied by this hit, in seconds. */
      controlDelaySeconds?: number;
      powerScale?: number;
      terminal?: boolean;
    }
  | {
      type: 'enemy_windup';
      time: number;
      instanceId: number;
      /** Seconds until the blow lands, so the clip can be fitted to it. */
      durationSeconds: number;
    }
  | { type: 'enemy_attack'; time: number; instanceId: number; damage: string }
  | { type: 'enemy_killed'; time: number; stage: number; instanceId: number; enemyId: string; gold: string }
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
