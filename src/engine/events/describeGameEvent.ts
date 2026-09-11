import { COMPANION_BY_ID } from '../companions/CompanionCatalog';
import type { GameEvent } from './GameEvent';
import { big, formatBig } from '../numbers';

/** Event payloads carry raw `Decimal.toString()` values; never show those. */
const n = (value: string): string => formatBig(big(value));

export function describeGameEvent(event: GameEvent): string {
  switch (event.type) {
    case 'meteor_queued':
      return 'A meteor gathers above the battlefield.';
    case 'effect_hit':
      return `${event.effect} deals ${n(event.damage)}.`;
    case 'status_applied':
      return `${event.status} applied (${event.stacks}).`;
    case 'combat_state':
      return `${event.state}: ${event.stacks}.`;
    case 'encounter_started':
      return `Stage ${event.stage}: ${event.totalEnemies} incoming.`;
    case 'enemy_spawned':
      return `${event.enemyName} enters (${event.spawned}/${event.total}).`;
    case 'spell_cast':
      return `Evercast cast (${event.projectiles} projectile${event.projectiles === 1 ? '' : 's'}).`;
    case 'projectile_hit':
      return `${event.critical ? 'Critical! ' : ''}${hitLabel(event.source)} hits for ${n(event.damage)}.`;
    case 'enemy_windup':
      return 'An enemy raises a weapon.';
    case 'enemy_attack':
      return `An enemy hits for ${n(event.damage)}.`;
    case 'enemy_killed':
      return `Enemy falls. +${n(event.gold)} Gold.`;
    case 'mage_defeated':
      return `The mage falls at stage ${event.stage}.`;
    case 'resource_gained':
      return `+${n(event.amount)} ${resourceLabel(event.resource)}.`;
    case 'stage_advanced':
      return `Frontier advanced to stage ${event.stage}.`;
    case 'mode_changed':
      return `${event.mode === 'farm' ? 'Farming' : 'Pushing'}: ${event.reason}.`;
    case 'gear_leveled':
      return `${event.slot} reached gear level ${event.level}.`;
    case 'gear_evolved':
      return `${event.name} evolved at gear level ${event.level}.`;
    case 'spell_point_purchased':
      return `Evercast absorbs ${n(event.cost)} Essence. +1 Spell Point.`;
    case 'spell_node_activated':
      return `${event.nodeName} awakened.`;
    case 'spell_tree_respecced':
      return `Evercast reshaped. ${event.refundedPoints} point${event.refundedPoints === 1 ? '' : 's'} returned.`;
    case 'rebirth_performed':
      return `Rebirth ${event.rebirths}: +${n(event.knowledgeGained)} Knowledge.`;
    case 'companion_attack':
      return `${companionName(event.definitionId)} strikes for ${n(event.damage)}.`;
    case 'companion_ability':
      return `${companionName(event.definitionId)} uses ${abilityLabel(event.ability)}.`;
    case 'companion_damaged':
      return `A companion takes ${n(event.damage)}.`;
    case 'companion_downed':
      return `${companionName(event.definitionId)} goes down.`;
    case 'companion_revived':
      return `${companionName(event.definitionId)} is back on its feet.`;
    case 'companion_summoned':
      return event.duplicate
        ? `${companionName(event.definitionId)} answers again. +${event.shards} shards.`
        : `${companionName(event.definitionId)} answers the call.`;
    case 'companion_ascended':
      return `${companionName(event.definitionId)} ascends to ${event.stars} stars.`;
    case 'companion_equipped':
      return event.definitionId
        ? `${companionName(event.definitionId)} joins the party.`
        : 'A party slot is emptied.';
  }
}

/** Authored names live in content; an unknown id must not crash the log. */
function companionName(definitionId: string): string {
  return COMPANION_BY_ID.get(definitionId)?.name ?? 'A companion';
}

function abilityLabel(ability: Extract<GameEvent, { type: 'companion_ability' }>['ability']): string {
  switch (ability) {
    case 'strike':
      return 'a heavy blow';
    case 'volley':
      return 'a volley';
    case 'guard':
      return 'its guard';
    case 'bulwark':
      return 'a bulwark';
    case 'mend':
      return 'a mending';
    case 'rally':
      return 'a rallying cry';
    case 'hex':
      return 'a hex';
    case 'wither':
      return 'a withering';
    case 'echo':
      return 'an echo';
    case 'revive':
      return 'a last rite';
  }
}

function hitLabel(source: Extract<GameEvent, { type: 'projectile_hit' }>['source']): string {
  switch (source) {
    case 'direct':
      return 'Evercast';
    case 'pierce':
      return 'Piercing Bolt';
    case 'chain':
      return 'Chain';
    case 'splash':
      return 'Splash';
    case 'repeat':
      return 'Echo';
  }
}

function resourceLabel(resource: Extract<GameEvent, { type: 'resource_gained' }>['resource']): string {
  switch (resource) {
    case 'essence':
      return 'Arcane Essence';
    case 'knowledge':
      return 'Knowledge';
    case 'gold':
      return 'Gold';
    case 'starlight':
      return 'Starlight';
  }
}
