import type { GameEvent } from '../../engine/events/GameEvent';

/**
 * How hard a batch of events should hit the camera.
 *
 * Pure, and separate from the thing that applies it, for the same reason the
 * audio plan is: the judgement about what deserves to shake the screen is worth
 * testing, and none of it needs a renderer.
 *
 * The three channels are deliberately different senses of "impact":
 *
 *   trauma   how much the camera is thrown about, and for how long
 *   hitStop  how long the picture freezes, which is what sells weight
 *   flash    a bloom and exposure kick, which is what sells power
 */
export interface ImpactResponse {
  trauma: number;
  hitStop: number;
  flash: number;
  /**
   * A boss falling, the mage dying, a rebirth. Only these earn a slow-motion
   * tail, and only these are allowed through the freeze refractory period -
   * inferring it from the size of `hitStop` instead put ordinary combat into
   * slow motion whenever enough crits landed at once.
   */
  climax: boolean;
}

export const NO_IMPACT: ImpactResponse = { trauma: 0, hitStop: 0, flash: 0, climax: false };

/**
 * The hard ceiling on a single batch's freeze, in seconds.
 *
 * Hit-stop is the one effect here that can be mistaken for the game being
 * broken, so freezes saturate rather than sum. The number is deliberately
 * small: at three or four frames it punctuates each cast, and measurement in a
 * real fight is what set it. A ceiling of 0.13 looked reasonable written down
 * and turned out to stop the picture for seven percent of all elapsed time,
 * because a busy frame saturates straight to whatever the ceiling is.
 */
export const MAX_HIT_STOP = 0.055;
/** A boss falling or the mage dying is allowed to hold longer than combat. */
export const MAX_CLIMAX_HIT_STOP = 0.28;

/** Two effects at 0.5 make 0.75, never 1.0: more always adds, and never maxes. */
function saturate(current: number, addition: number): number {
  return current + (1 - current) * Math.min(1, Math.max(0, addition));
}

interface Beat {
  trauma: number;
  hitStop: number;
  flash: number;
  /** Climaxes may exceed the ordinary freeze ceiling. */
  climax?: boolean;
}

function beatFor(event: GameEvent, isBoss: (instanceId: number) => boolean): Beat | null {
  switch (event.type) {
    case 'projectile_hit':
      return event.critical
        ? { trauma: 0.4, hitStop: 0.03, flash: 0.34 }
        : { trauma: 0.09, hitStop: 0, flash: 0.05 };
    case 'effect_hit':
      if (event.effect === 'dot') return null;
      return event.effect === 'meteor'
        ? { trauma: 0.55, hitStop: 0.05, flash: 0.5 }
        : { trauma: 0.34, hitStop: 0.025, flash: 0.34 };
    case 'enemy_killed':
      return isBoss(event.instanceId)
        ? { trauma: 0.85, hitStop: 0.22, flash: 0.75, climax: true }
        : { trauma: 0.22, hitStop: 0.02, flash: 0.16 };
    case 'enemy_attack':
      return { trauma: 0.16, hitStop: 0, flash: 0 };
    case 'mage_defeated':
      return { trauma: 0.6, hitStop: 0.26, flash: 0.45, climax: true };
    case 'combat_state':
      // The threshold states, as in the audio plan: the per-cast counters would
      // shake the camera on every single cast.
      return event.state === 'overdrive' || event.state === 'velocity'
        ? { trauma: 0.34, hitStop: 0, flash: 0.5 }
        : null;
    case 'spell_cast':
      return event.perfect ? { trauma: 0.12, hitStop: 0, flash: 0.28 } : null;
    case 'rebirth_performed':
      return { trauma: 0.55, hitStop: 0.2, flash: 1, climax: true };
    case 'gear_evolved':
    case 'spell_node_activated':
      return { trauma: 0.14, hitStop: 0, flash: 0.3 };
    default:
      return null;
  }
}

export function planImpact(
  events: readonly GameEvent[],
  isBoss: (instanceId: number) => boolean = () => false,
): ImpactResponse {
  let trauma = 0;
  let flash = 0;
  let hitStop = 0;
  let ceiling = MAX_HIT_STOP;
  let climax = false;

  for (const event of events) {
    const beat = beatFor(event, isBoss);
    if (!beat) continue;
    trauma = saturate(trauma, beat.trauma);
    flash = saturate(flash, beat.flash);
    hitStop = saturate(hitStop / MAX_CLIMAX_HIT_STOP, beat.hitStop / MAX_CLIMAX_HIT_STOP) *
      MAX_CLIMAX_HIT_STOP;
    if (beat.climax) {
      ceiling = MAX_CLIMAX_HIT_STOP;
      climax = true;
    }
  }

  return { trauma, flash, climax, hitStop: Math.min(hitStop, ceiling) };
}
