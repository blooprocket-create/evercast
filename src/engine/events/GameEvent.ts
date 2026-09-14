import type { CompanionAbilityId, CompanionRarity } from '../companions/types';
import type { GearSlot } from '../gear/types';
import type { CombatPosition } from '../combat/SpellCombatState';
import type { ResourceKind } from '../types';

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
      effect: 'explosion' | 'meteor' | 'dot' | 'necrosis';
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
  | {
      type: 'enemy_attack';
      time: number;
      instanceId: number;
      damage: string;
      /** The party slot that took it; absent when the mage did. */
      targetSlot?: number;
    }
  | { type: 'enemy_killed'; time: number; stage: number; instanceId: number; enemyId: string; gold: string }
  | { type: 'mage_defeated'; time: number; stage: number }
  | {
      type: 'resource_gained';
      time: number;
      resource: ResourceKind;
      amount: string;
    }
  | { type: 'stage_advanced'; time: number; stage: number }
  /**
   * `reason` is a closed set rather than a free string so that the one place
   * that turns an event into a sentence can cover it exhaustively. It used to
   * be interpolated raw, which put "Farming: frontier defeat." in the log.
   */
  | {
      type: 'mode_changed';
      time: number;
      mode: 'push' | 'farm';
      reason: 'frontier defeat' | 'automatic frontier retry' | 'manual frontier retry';
    }
  | { type: 'gear_leveled'; time: number; slot: GearSlot; level: number; cost: string }
  | { type: 'gear_evolved'; time: number; slot: GearSlot; level: number; evolutionTier: number; name: string }
  | { type: 'spell_point_purchased'; time: number; purchasedPoints: number; cost: string }
  | {
      type: 'attunement_purchased';
      time: number;
      attunementId: string;
      attunementName: string;
      cost: string;
    }
  | { type: 'spell_node_activated'; time: number; nodeId: string; nodeName: string }
  | { type: 'spell_tree_respecced'; time: number; refundedPoints: number }
  | { type: 'rebirth_performed'; time: number; knowledgeGained: string; rebirths: number }
  /**
   * Companion events. Like `projectile_hit`, these carry what actually
   * happened rather than what the build implies, so Babylon animates facts
   * instead of re-deriving combat from stats.
   */
  | {
      type: 'companion_attack';
      time: number;
      slot: number;
      definitionId: string;
      instanceId: number;
      damage: string;
      critical: boolean;
    }
  | {
      type: 'companion_ability';
      time: number;
      slot: number;
      definitionId: string;
      ability: CompanionAbilityId;
      /** Healing restored, damage dealt or shield granted, by ability. */
      amount: string;
      /** Enemy instance ids or party slots the ability landed on. */
      targets: number[];
      /**
       * Damage actually dealt, per enemy. Empty for an ability that deals none
       * - a debuff lands on a target without hurting it, and `amount` is a
       * total, so neither can say what any one enemy took.
       */
      hits: { instanceId: number; damage: string }[];
    }
  | {
      type: 'companion_damaged';
      time: number;
      slot: number;
      instanceId: number;
      /** Health actually lost, after any shield and clamped at nothing left. */
      damage: string;
      /** The part of the blow a bulwark ate instead. */
      absorbed: string;
    }
  | { type: 'companion_downed'; time: number; slot: number; definitionId: string }
  | { type: 'companion_revived'; time: number; slot: number; definitionId: string }
  | {
      type: 'companion_summoned';
      time: number;
      definitionId: string;
      rarity: CompanionRarity;
      duplicate: boolean;
      shards: number;
      stars: number;
    }
  | { type: 'companion_ascended'; time: number; definitionId: string; stars: number }
  | {
      type: 'companion_equipped';
      time: number;
      /** Null when a slot is cleared. */
      definitionId: string | null;
      slot: number;
    };
