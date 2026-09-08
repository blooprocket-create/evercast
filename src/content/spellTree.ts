import type { SpellModifier } from '../engine/spell/types';
import type { SpellTreeNodeDefinition } from '../engine/spellTree/types';

const stat = (
  id: string,
  statName: 'damage' | 'castSpeed' | 'projectiles' | 'critChance' | 'critMultiplier',
  value: number,
): SpellModifier => ({ id, kind: 'stat', stat: statName, operation: 'add', value });

const combat = (
  id: string,
  action:
    | { kind: 'pierce'; count: number }
    | { kind: 'splash'; targets: number; damageMultiplier: number }
    | { kind: 'chain'; count: number; damageMultiplier: number }
    | { kind: 'control'; delaySeconds: number }
    | { kind: 'leech'; fraction: number },
): SpellModifier => ({ id, kind: 'combat', action });

const trigger = (
  id: string,
  triggerName: 'onHit' | 'onCrit' | 'onKill',
  action:
    | { kind: 'bonusDamage'; multiplier: number; retrigger?: boolean }
    | { kind: 'repeatProjectile'; count: number; damageMultiplier: number },
): SpellModifier => ({ id, kind: 'trigger', trigger: triggerName, action });

export const SPELL_TREE_ROOT_ID = 'evercast_root';
export const SPELL_TREE_STARTER_POINTS = 1;
export const SPELL_POINT_BASE_COST = 8;
export const SPELL_POINT_COST_GROWTH = 1.27;

export const SPELL_TREE_NODES: readonly SpellTreeNodeDefinition[] = [
  {
    id: SPELL_TREE_ROOT_ID,
    name: 'Evercast',
    description: 'The one true spell. Every path grows from here.',
    region: 'core', kind: 'root', requires: [], modifiers: [],
  },

  { id: 'power_1', name: 'Force', description: '+1 base spell damage.', region: 'power', kind: 'minor', requires: [SPELL_TREE_ROOT_ID], modifiers: [stat('power_1_damage', 'damage', 1)] },
  { id: 'power_2', name: 'Pressure', description: '+1 base spell damage.', region: 'power', kind: 'minor', requires: ['power_1'], modifiers: [stat('power_2_damage', 'damage', 1)] },
  { id: 'power_notable', name: 'Overcharge', description: '+2 base spell damage. Opens the high-power outer paths.', region: 'power', kind: 'notable', requires: ['power_2'], modifiers: [stat('power_notable_damage', 'damage', 2)] },

  { id: 'speed_1', name: 'Quickening', description: 'Cast more often.', region: 'speed', kind: 'minor', requires: [SPELL_TREE_ROOT_ID], modifiers: [stat('speed_1_cast', 'castSpeed', 0.08)] },
  { id: 'speed_2', name: 'Cadence', description: 'Further increases cast rate.', region: 'speed', kind: 'minor', requires: ['speed_1'], modifiers: [stat('speed_2_cast', 'castSpeed', 0.09)] },
  { id: 'speed_notable', name: 'Spell Rhythm', description: 'A large cast-rate increase. Opens Frost and Storm paths.', region: 'speed', kind: 'notable', requires: ['speed_2'], modifiers: [stat('speed_notable_cast', 'castSpeed', 0.14)] },

  { id: 'projectile_1', name: 'Second Thread', description: '+1 projectile per cast.', region: 'projectile', kind: 'minor', requires: [SPELL_TREE_ROOT_ID], modifiers: [stat('projectile_1_count', 'projectiles', 1)] },
  { id: 'projectile_2', name: 'Arcane Volley', description: '+1 projectile per cast.', region: 'projectile', kind: 'minor', requires: ['projectile_1'], modifiers: [stat('projectile_2_count', 'projectiles', 1)] },
  { id: 'projectile_notable', name: 'Manyfold', description: '+1 projectile. Opens Arcane and Storm projectile paths.', region: 'projectile', kind: 'notable', requires: ['projectile_2'], modifiers: [stat('projectile_notable_count', 'projectiles', 1)] },

  { id: 'crit_1', name: 'Focus', description: '+5% critical strike chance.', region: 'crit', kind: 'minor', requires: [SPELL_TREE_ROOT_ID], modifiers: [stat('crit_1_chance', 'critChance', 0.05)] },
  { id: 'crit_2', name: 'Precision', description: '+7% critical strike chance.', region: 'crit', kind: 'minor', requires: ['crit_1'], modifiers: [stat('crit_2_chance', 'critChance', 0.07)] },
  { id: 'crit_notable', name: 'Arcane Edge', description: '+0.5 critical multiplier. Opens Fire, Blood, and Arcane paths.', region: 'crit', kind: 'notable', requires: ['crit_2'], modifiers: [stat('crit_notable_multi', 'critMultiplier', 0.5)] },

  { id: 'arcane_entry', name: 'Pure Arcana', description: '+1 damage and enter the Arcane region.', region: 'arcane', kind: 'minor', requires: ['power_notable', 'projectile_notable', 'crit_notable'], modifiers: [stat('arcane_entry_damage', 'damage', 1)] },
  { id: 'arcane_pierce', name: 'Phasing Bolt', description: 'Each projectile pierces through 1 additional living enemy.', region: 'arcane', kind: 'notable', requires: ['arcane_entry'], modifiers: [combat('arcane_pierce_1', { kind: 'pierce', count: 1 })] },
  { id: 'arcane_precision', name: 'Unerring Formula', description: '+8% critical chance.', region: 'arcane', kind: 'minor', requires: ['arcane_pierce'], modifiers: [stat('arcane_precision_crit', 'critChance', 0.08)] },
  { id: 'arcane_echo', name: 'Echoing Glyph', description: 'Critical hits repeat 1 projectile at 55% damage.', region: 'arcane', kind: 'notable', requires: ['arcane_precision'], modifiers: [trigger('arcane_echo_repeat', 'onCrit', { kind: 'repeatProjectile', count: 1, damageMultiplier: 0.55 })] },
  { id: 'arcane_mutation', name: 'Singularity Script', description: 'MUTATION: +2 pierce and +2 base damage.', region: 'arcane', kind: 'mutation', requires: ['arcane_echo'], modifiers: [combat('arcane_mutation_pierce', { kind: 'pierce', count: 2 }), stat('arcane_mutation_damage', 'damage', 2)] },

  { id: 'fire_entry', name: 'Ember Script', description: '+1 base damage and enter Fire.', region: 'fire', kind: 'minor', requires: ['power_notable', 'crit_notable'], modifiers: [stat('fire_entry_damage', 'damage', 1)] },
  { id: 'fire_splash', name: 'Cinderburst', description: 'Hits splash 25% damage to up to 2 other enemies.', region: 'fire', kind: 'notable', requires: ['fire_entry'], modifiers: [combat('fire_splash_1', { kind: 'splash', targets: 2, damageMultiplier: 0.25 })] },
  { id: 'fire_heat', name: 'Rising Heat', description: '+2 base damage.', region: 'fire', kind: 'minor', requires: ['fire_splash'], modifiers: [stat('fire_heat_damage', 'damage', 2)] },
  { id: 'fire_combustion', name: 'Combustion Pattern', description: 'Splash can reach 2 more enemies.', region: 'fire', kind: 'notable', requires: ['fire_heat'], modifiers: [combat('fire_splash_2', { kind: 'splash', targets: 2, damageMultiplier: 0.25 })] },
  { id: 'fire_mutation', name: 'Inferno Core', description: 'MUTATION: Splash reaches 3 more enemies and uses 45% hit damage.', region: 'fire', kind: 'mutation', requires: ['fire_combustion'], modifiers: [combat('fire_inferno', { kind: 'splash', targets: 3, damageMultiplier: 0.45 })] },

  { id: 'frost_entry', name: 'Cold Thread', description: 'Hits delay the target’s next attack by 0.08s.', region: 'frost', kind: 'minor', requires: ['speed_notable'], modifiers: [combat('frost_delay_1', { kind: 'control', delaySeconds: 0.08 })] },
  { id: 'frost_shards', name: 'Splintering Ice', description: '+1 projectile.', region: 'frost', kind: 'minor', requires: ['frost_entry'], modifiers: [stat('frost_projectile', 'projectiles', 1)] },
  { id: 'frost_chill', name: 'Deep Chill', description: 'Hits add another 0.12s attack delay.', region: 'frost', kind: 'minor', requires: ['frost_shards'], modifiers: [combat('frost_delay_2', { kind: 'control', delaySeconds: 0.12 })] },
  { id: 'frost_lock', name: 'Time in Ice', description: 'Hits add another 0.22s attack delay.', region: 'frost', kind: 'notable', requires: ['frost_chill'], modifiers: [combat('frost_delay_3', { kind: 'control', delaySeconds: 0.22 })] },
  { id: 'frost_mutation', name: 'Absolute Stillness', description: 'MUTATION: Hits add another 0.40s delay and casting accelerates.', region: 'frost', kind: 'mutation', requires: ['frost_lock'], modifiers: [combat('frost_delay_4', { kind: 'control', delaySeconds: 0.4 }), stat('frost_mutation_speed', 'castSpeed', 0.1)] },

  { id: 'storm_entry', name: 'Static Thread', description: 'Hits chain once to another enemy for 45% damage.', region: 'storm', kind: 'minor', requires: ['projectile_notable', 'speed_notable'], modifiers: [combat('storm_chain_1', { kind: 'chain', count: 1, damageMultiplier: 0.45 })] },
  { id: 'storm_current', name: 'Live Current', description: 'Cast faster.', region: 'storm', kind: 'minor', requires: ['storm_entry'], modifiers: [stat('storm_speed', 'castSpeed', 0.09)] },
  { id: 'storm_chain', name: 'Forked Current', description: 'Chain to 1 additional enemy.', region: 'storm', kind: 'minor', requires: ['storm_current'], modifiers: [combat('storm_chain_2', { kind: 'chain', count: 1, damageMultiplier: 0.45 })] },
  { id: 'storm_tempest', name: 'Tempest Circuit', description: 'Chain to 1 additional enemy and +5% crit.', region: 'storm', kind: 'notable', requires: ['storm_chain'], modifiers: [combat('storm_chain_3', { kind: 'chain', count: 1, damageMultiplier: 0.45 }), stat('storm_tempest_crit', 'critChance', 0.05)] },
  { id: 'storm_mutation', name: 'Forked Heavens', description: 'MUTATION: Chain to 2 additional enemies.', region: 'storm', kind: 'mutation', requires: ['storm_tempest'], modifiers: [combat('storm_chain_4', { kind: 'chain', count: 2, damageMultiplier: 0.45 })] },

  { id: 'blood_entry', name: 'Sanguine Ink', description: 'Heal for 2% of direct hit damage.', region: 'blood', kind: 'minor', requires: ['power_notable', 'crit_notable'], modifiers: [combat('blood_leech_1', { kind: 'leech', fraction: 0.02 })] },
  { id: 'blood_force', name: 'Red Pressure', description: '+2 base damage.', region: 'blood', kind: 'minor', requires: ['blood_entry'], modifiers: [stat('blood_damage', 'damage', 2)] },
  { id: 'blood_hunger', name: 'Hunger', description: 'Heal for an additional 3% of direct hit damage.', region: 'blood', kind: 'minor', requires: ['blood_force'], modifiers: [combat('blood_leech_2', { kind: 'leech', fraction: 0.03 })] },
  { id: 'blood_rite', name: 'Crimson Rite', description: '+0.5 crit multiplier and 5% crit chance.', region: 'blood', kind: 'notable', requires: ['blood_hunger'], modifiers: [stat('blood_multi', 'critMultiplier', 0.5), stat('blood_crit', 'critChance', 0.05)] },
  { id: 'blood_mutation', name: 'Covenant of One', description: 'MUTATION: +2 damage and heal for another 10% of direct hit damage.', region: 'blood', kind: 'mutation', requires: ['blood_rite'], modifiers: [stat('blood_mutation_damage', 'damage', 2), combat('blood_leech_3', { kind: 'leech', fraction: 0.1 })] },
] as const;

export const SPELL_TREE_NODE_BY_ID = new Map(SPELL_TREE_NODES.map((node) => [node.id, node]));

export function spellPointCost(purchasedPoints: number): number {
  const index = Math.max(0, Math.floor(purchasedPoints));
  return Math.max(1, Math.floor(SPELL_POINT_BASE_COST * Math.pow(SPELL_POINT_COST_GROWTH, index)));
}

export function adjacentNodeIds(nodeId: string): string[] {
  const adjacent = new Set<string>();
  const node = SPELL_TREE_NODE_BY_ID.get(nodeId);
  for (const id of node?.requires ?? []) adjacent.add(id);
  for (const candidate of SPELL_TREE_NODES) {
    if (candidate.requires.includes(nodeId)) adjacent.add(candidate.id);
  }
  return [...adjacent];
}
