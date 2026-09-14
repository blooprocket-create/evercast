import type { GameEvent } from './GameEvent';

/**
 * Whether an event earns a line in the chronicle, and what that line is about.
 *
 * The log used to be `describeGameEvent(lastEvent)` - every event, one line,
 * overwritten by the next. At late game the simulation emits several events
 * per second, so the line strobed through text nobody could read, and the
 * three things a player actually needs from a log - the mage fell, a companion
 * went down, a gear piece evolved - went past inside a wall of `Direct hits
 * for 9.97e47.`
 *
 * So the log is a chronicle now, and this is the editorial policy. Combat is
 * dropped: it is what the diorama, the damage numbers and the HUD enemy card
 * are for, and it is the only thing in the game that happens faster than
 * reading. What is kept is what a player would scroll back to find.
 */
export interface LogWeight {
  /** Whether it earns a line at all. */
  line: boolean;
  /**
   * What a *running* line is about.
   *
   * Some progress is continuous rather than punctual: the frontier advances
   * every few seconds while pushing, and buying ten gear levels emits ten
   * events. Left alone, either would push everything else off the end within a
   * minute. A line whose subject matches the newest line replaces it instead
   * of following it, so a run of them is one line that ticks - `Frontier
   * advanced to stage 412.` becoming `413.` - rather than four hundred.
   *
   * Keyed per gear slot rather than per event type, so levelling Boots does
   * not silently swallow the Helm line above it.
   */
  subject?: string;
}

const DROP: LogWeight = { line: false };
const KEEP: LogWeight = { line: true };

export function logWeight(event: GameEvent): LogWeight {
  switch (event.type) {
    /*
     * Combat, at the rate combat happens. All of it is already on screen: the
     * scene animates the casts and the blows, `DamageNumbers` carries the
     * figures, and the HUD enemy card carries the name, the health and the
     * wave. A log is the wrong instrument for something that happens ten times
     * a second.
     */
    case 'spell_cast':
    case 'projectile_hit':
    case 'effect_hit':
    case 'meteor_queued':
    case 'status_applied':
    case 'combat_state':
    case 'enemy_spawned':
    case 'enemy_windup':
    case 'enemy_attack':
    case 'enemy_killed':
    case 'resource_gained':
    case 'companion_attack':
    case 'companion_ability':
    case 'companion_damaged':
      return DROP;

    /* A boss is an occasion. The other ninety-nine encounters are the game running. */
    case 'encounter_started':
      return event.boss ? KEEP : DROP;

    /* Continuous progress: one line each, ticking. See `subject`. */
    case 'stage_advanced':
      return { line: true, subject: 'stage' };
    case 'gear_leveled':
      return { line: true, subject: `gear:${event.slot}` };
    case 'spell_point_purchased':
      return { line: true, subject: 'spell-point' };

    /*
     * The rest is what the chronicle exists for - every one of them is either
     * something the player chose, or something that happened to them. None can
     * repeat fast enough to need folding.
     */
    case 'mage_defeated':
    case 'mode_changed':
    case 'gear_evolved':
    case 'attunement_purchased':
    case 'spell_node_activated':
    case 'spell_tree_respecced':
    case 'rebirth_performed':
    case 'companion_downed':
    case 'companion_revived':
    case 'companion_summoned':
    case 'companion_ascended':
    case 'companion_equipped':
      return KEEP;
  }
}
