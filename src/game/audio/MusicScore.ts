/**
 * The score, as pure numbers.
 *
 * Evercast has no fixed track length - a run is however long the player leaves
 * it - so the music is generated bar by bar rather than looped from a file.
 * Keeping the composition here, as functions of (zone, bar, intensity), means
 * the musical decisions can be tested and adjusted without an AudioContext
 * anywhere near them; `AudioEngine` only turns these numbers into oscillators.
 */

/** Semitone offsets from the tonic. */
const MODES = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
} as const;

export interface MusicMood {
  /** Tonic in Hz. */
  root: number;
  scale: readonly number[];
  /** Scale degrees per bar; the progression wraps. */
  progression: readonly number[];
  beatsPerMinute: number;
  padWave: OscillatorType;
  leadWave: OscillatorType;
}

const GREENFIELDS: MusicMood = {
  root: 174.61, // F3
  scale: MODES.ionian,
  progression: [0, 5, 3, 4],
  beatsPerMinute: 86,
  padWave: 'triangle',
  leadWave: 'sine',
};

const WHISPERING_WOODS: MusicMood = {
  root: 146.83, // D3
  scale: MODES.dorian,
  progression: [0, 6, 3, 0],
  beatsPerMinute: 78,
  padWave: 'triangle',
  leadWave: 'triangle',
};

const GRAVEHOLLOW: MusicMood = {
  root: 110, // A2
  scale: MODES.aeolian,
  progression: [0, 5, 2, 6],
  beatsPerMinute: 72,
  padWave: 'sawtooth',
  leadWave: 'sine',
};

const ASHEN_ROAD: MusicMood = {
  root: 130.81, // C3
  scale: MODES.phrygian,
  progression: [0, 1, 0, 6],
  beatsPerMinute: 96,
  padWave: 'sawtooth',
  leadWave: 'square',
};

/** One per zone, in zone order, cycling once the road runs out of zones. */
const MOODS: readonly MusicMood[] = [GREENFIELDS, WHISPERING_WOODS, GRAVEHOLLOW, ASHEN_ROAD];

/**
 * A boss is the same place, heard differently: the mode darkens by a step and
 * the tempo lifts, so it reads as pressure rather than as a different track.
 */
function darken(mood: MusicMood): MusicMood {
  return {
    ...mood,
    scale: mood.scale === MODES.phrygian ? MODES.phrygian : MODES.aeolian,
    progression: [0, 6, 0, 5],
    beatsPerMinute: mood.beatsPerMinute + 14,
    padWave: 'sawtooth',
    leadWave: 'square',
  };
}

/** `zone` is 1-based, as the snapshot reports it. */
export function moodFor(zone: number, boss = false): MusicMood {
  const index = Math.max(0, Math.floor(zone) - 1) % MOODS.length;
  const mood = MOODS[index] ?? GREENFIELDS;
  return boss ? darken(mood) : mood;
}

export const BEATS_PER_BAR = 4;

export function barSeconds(mood: MusicMood): number {
  return (60 / mood.beatsPerMinute) * BEATS_PER_BAR;
}

/** Hz for a scale degree, wrapping into higher octaves as the degree climbs. */
export function degreeHz(mood: MusicMood, degree: number): number {
  const size = mood.scale.length;
  const octave = Math.floor(degree / size);
  const step = ((degree % size) + size) % size;
  const semitone = (mood.scale[step] ?? 0) + octave * 12;
  return mood.root * Math.pow(2, semitone / 12);
}

/** Root, third and fifth of the bar's chord - the pad. */
export function barChord(mood: MusicMood, bar: number): number[] {
  const degree = mood.progression[Math.abs(Math.floor(bar)) % mood.progression.length] ?? 0;
  return [degree, degree + 2, degree + 4].map((step) => degreeHz(mood, step));
}

export interface MusicNote {
  /** Beat within the bar, fractional. */
  beat: number;
  hz: number;
  /** Beats. */
  duration: number;
  gain: number;
}

/**
 * The arpeggio over one bar.
 *
 * `intensity` (0 when travelling, 1 mid-fight) opens the part up rather than
 * merely turning it up: quiet stretches get half the notes and none of the
 * upper octave, so combat arrives as more music, not just louder music.
 */
export function barArpeggio(mood: MusicMood, bar: number, intensity: number): MusicNote[] {
  const clamped = Math.min(1, Math.max(0, intensity));
  const degree = mood.progression[Math.abs(Math.floor(bar)) % mood.progression.length] ?? 0;
  const shape = clamped > 0.55 ? [0, 2, 4, 2, 7, 4, 2, 4] : [0, 4, 2, 4];
  const beatStep = BEATS_PER_BAR / shape.length;

  return shape.map((offset, index) => ({
    beat: index * beatStep,
    hz: degreeHz(mood, degree + offset + 7),
    duration: beatStep * 0.9,
    gain: (0.16 + clamped * 0.14) * (index % 2 === 0 ? 1 : 0.7),
  }));
}

/** The bass: the tonic on the downbeat, with a push on the half bar when busy. */
export function barBass(mood: MusicMood, bar: number, intensity: number): MusicNote[] {
  const clamped = Math.min(1, Math.max(0, intensity));
  const degree = mood.progression[Math.abs(Math.floor(bar)) % mood.progression.length] ?? 0;
  const hz = degreeHz(mood, degree) / 2;
  const notes: MusicNote[] = [
    { beat: 0, hz, duration: 1.8, gain: 0.3 + clamped * 0.12 },
  ];
  if (clamped > 0.35) {
    notes.push({ beat: BEATS_PER_BAR / 2, hz, duration: 1.2, gain: 0.22 + clamped * 0.1 });
  }
  return notes;
}
