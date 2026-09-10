import type { GameEvent } from '../../engine/events/GameEvent';

/**
 * Turns a batch of presentation events into the handful of sounds actually
 * worth playing, before any of it reaches WebAudio.
 *
 * The engine emits one `projectile_hit` per projectile per target, which in a
 * wide build is dozens per cast. Playing all of them is a machine gun, and
 * playing them at full gain is a wall. So this collapses, prioritises and
 * ducks - the same job VfxPool's budgets do for particles.
 *
 * Pure, so the decisions are testable without an AudioContext.
 */
export type VoiceName =
  | 'cast'
  | 'impact'
  | 'crit'
  | 'blast'
  | 'meteor'
  | 'surge'
  | 'perfect'
  | 'kill'
  | 'bossKill'
  | 'enemyAttack'
  | 'defeat'
  | 'levelUp'
  | 'awaken'
  | 'advance'
  | 'rebirth';

export interface AudioCue {
  voice: VoiceName;
  /** 0 to 1, before the bus gains. */
  gain: number;
  /** Semitones, for variety between repeats. */
  detune: number;
  /** Seconds from the start of this batch. */
  at: number;
}

/** How many of each kind survive one batch. Combat is the only noisy one. */
export const AUDIO_BUDGET = {
  cues: 12,
  impacts: 4,
  effectHits: 3,
  enemyAttacks: 2,
} as const;

const STAGGER = 0.035;

/**
 * A crowd should be bigger than one hit, but nowhere near proportionally.
 *
 * The obvious 1/sqrt(n) is wrong here: with a capped number of voices it makes
 * twenty hits quieter in total than a single one, so a full wave lands softer
 * than a lone strike. This grows logarithmically instead, so more hits always
 * means more sound - just far less than the arithmetic would suggest.
 */
function ducked(base: number, index: number, total: number): number {
  const crowd = 1 / (1 + Math.log2(Math.max(1, total)) * 0.25);
  const order = Math.max(0.4, 1 - index * 0.12);
  return Math.max(0.08, base * crowd * order);
}

/**
 * Whether an enemy instance is the encounter's boss.
 *
 * `enemy_killed` does not say - only `enemy_spawned` does - and a boss stage
 * also spawns adds, so an encounter-level flag would fire the boss sting for a
 * minion. Identity has to be carried across batches, so the caller owns that
 * set and answers the question here; the plan itself stays pure.
 */
export type IsBoss = (instanceId: number) => boolean;

const NOT_BOSS: IsBoss = () => false;

export function planAudio(events: readonly GameEvent[], isBoss: IsBoss = NOT_BOSS): AudioCue[] {
  const cues: AudioCue[] = [];
  const hits = events.filter(
    (event): event is Extract<GameEvent, { type: 'projectile_hit' }> =>
      event.type === 'projectile_hit',
  );
  const attacks = events.filter((event) => event.type === 'enemy_attack');

  // One cast sound however many projectiles it threw.
  const cast = events.find((event) => event.type === 'spell_cast');
  if (cast) cues.push({ voice: 'cast', gain: 0.55, detune: 0, at: 0 });
  if (cast?.type === 'spell_cast' && cast.perfect) {
    cues.push({ voice: 'perfect', gain: 0.5, detune: 0, at: 0.03 });
  }

  // Crits first: if something has to be dropped, it should not be the crit.
  const ranked = [...hits].sort((a, b) => Number(b.critical) - Number(a.critical));
  const audible = ranked.slice(0, AUDIO_BUDGET.impacts);
  audible.forEach((hit, index) => {
    cues.push({
      voice: hit.critical ? 'crit' : 'impact',
      gain: ducked(hit.critical ? 0.85 : 0.5, index, hits.length),
      detune: ((hit.instanceId * 7) % 9) - 4,
      at: 0.02 + index * STAGGER,
    });
  });

  // Meteors and explosions. Damage-over-time ticks are deliberately silent:
  // they fire on a timer whatever the player does, so giving them a voice is a
  // metronome nobody asked for, and the effect is already on screen.
  const effects = events.filter(
    (event): event is Extract<GameEvent, { type: 'effect_hit' }> =>
      event.type === 'effect_hit' && event.effect !== 'dot',
  );
  const rankedEffects = [...effects].sort(
    (a, b) => Number(b.effect === 'meteor') - Number(a.effect === 'meteor'),
  );
  rankedEffects.slice(0, AUDIO_BUDGET.effectHits).forEach((effect, index) => {
    cues.push({
      voice: effect.effect === 'meteor' ? 'meteor' : 'blast',
      gain: ducked(effect.effect === 'meteor' ? 0.8 : 0.6, index, effects.length),
      detune: ((effect.effectId * 5) % 7) - 3,
      at: 0.03 + index * STAGGER * 1.6,
    });
  });

  attacks.slice(0, AUDIO_BUDGET.enemyAttacks).forEach((_, index) => {
    cues.push({
      voice: 'enemyAttack',
      gain: ducked(0.45, index, attacks.length),
      detune: index * 2,
      at: 0.01 + index * STAGGER,
    });
  });

  for (const event of events) {
    switch (event.type) {
      case 'enemy_killed':
        // One death sound per batch; a cleared wave should not be a pile-up.
        if (!cues.some((cue) => cue.voice === 'kill' || cue.voice === 'bossKill')) {
          cues.push({ voice: 'kill', gain: 0.42, detune: 0, at: 0.12 });
        }
        break;
      case 'combat_state':
        // Momentum, focus and supercharge are per-cast counters, so sounding
        // them would just double the cast. Overdrive and terminal velocity are
        // threshold states - they are the moments worth announcing.
        if (
          (event.state === 'overdrive' || event.state === 'velocity') &&
          !cues.some((cue) => cue.voice === 'surge')
        ) {
          cues.push({ voice: 'surge', gain: 0.6, detune: 0, at: 0.02 });
        }
        break;
      case 'mage_defeated':
        cues.push({ voice: 'defeat', gain: 0.9, detune: 0, at: 0 });
        break;
      case 'stage_advanced':
        cues.push({ voice: 'advance', gain: 0.5, detune: 0, at: 0 });
        break;
      case 'gear_leveled':
      case 'spell_point_purchased':
        cues.push({ voice: 'levelUp', gain: 0.45, detune: 0, at: 0 });
        break;
      case 'gear_evolved':
      case 'spell_node_activated':
        cues.push({ voice: 'awaken', gain: 0.7, detune: 0, at: 0 });
        break;
      case 'rebirth_performed':
        cues.push({ voice: 'rebirth', gain: 1, detune: 0, at: 0 });
        break;
      default:
        break;
    }
  }

  // A boss dying outranks the generic death sound.
  if (events.some((event) => event.type === 'enemy_killed' && isBoss(event.instanceId))) {
    const index = cues.findIndex((cue) => cue.voice === 'kill');
    if (index >= 0) cues[index] = { voice: 'bossKill', gain: 0.9, detune: 0, at: 0.1 };
  }

  // A single batch can still be a whole offline catch-up. Keep the loudest.
  return cues.sort((a, b) => b.gain - a.gain).slice(0, AUDIO_BUDGET.cues);
}
