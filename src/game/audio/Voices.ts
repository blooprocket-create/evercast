/**
 * Every sound in Evercast is synthesised here rather than loaded from a file.
 *
 * That is a deliberate trade. Synthesis keeps the repository free of binary
 * audio and its licensing, costs nothing to download, and - the part that
 * actually matters for a game about one endlessly evolving spell - lets the
 * sound follow the gameplay: a crit is not a different file, it is the same
 * voice opened up.
 */

let noiseBuffer: AudioBuffer | null = null;

/** One second of white noise, made once and shared by every burst. */
function noise(context: BaseAudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === context.sampleRate) return noiseBuffer;
  const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < channel.length; i += 1) channel[i] = Math.random() * 2 - 1;
  noiseBuffer = buffer;
  return buffer;
}

const semitones = (base: number, offset: number) => base * Math.pow(2, offset / 12);

export interface ToneOptions {
  type?: OscillatorType;
  from: number;
  to?: number;
  at: number;
  duration: number;
  peak: number;
  attack?: number;
  /**
   * Seconds held at full level before the decay starts. Zero - the default -
   * gives the percussive attack-and-fall every combat voice wants; a pad needs
   * a real sustain, because an exponential fall spends most of its length near
   * silence and a bed built that way is inaudible under the first hit.
   */
  hold?: number;
  detune?: number;
}

/** A single enveloped oscillator that disposes of itself when it finishes. */
export function tone(context: AudioContext, destination: AudioNode, options: ToneOptions): void {
  const { type = 'sine', from, to = from, at, duration, peak, attack = 0.005, hold = 0, detune = 0 } = options;
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(semitones(from, detune), at);
  if (to !== from) oscillator.frequency.exponentialRampToValueAtTime(semitones(to, detune), at + duration);

  const level = Math.max(0.0002, peak);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(level, at + attack);
  // A ramp runs from the previous event, so the sustain is one scheduled point.
  if (hold > 0) gain.gain.setValueAtTime(level, Math.min(at + attack + hold, at + duration));
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);

  oscillator.connect(gain).connect(destination);
  oscillator.start(at);
  oscillator.stop(at + duration + 0.02);
  oscillator.onended = () => {
    oscillator.disconnect();
    gain.disconnect();
  };
}

export interface BurstOptions {
  at: number;
  duration: number;
  peak: number;
  frequency: number;
  q?: number;
  type?: BiquadFilterType;
}

/** A filtered noise burst: the body of every impact. */
export function burst(context: AudioContext, destination: AudioNode, options: BurstOptions): void {
  const { at, duration, peak, frequency, q = 1, type = 'bandpass' } = options;
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();

  source.buffer = noise(context);
  filter.type = type;
  filter.frequency.setValueAtTime(frequency, at);
  filter.Q.value = q;

  gain.gain.setValueAtTime(Math.max(0.0002, peak), at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);

  source.connect(filter).connect(gain).connect(destination);
  source.start(at);
  source.stop(at + duration + 0.02);
  source.onended = () => {
    source.disconnect();
    filter.disconnect();
    gain.disconnect();
  };
}

export interface VoiceContext {
  context: AudioContext;
  destination: AudioNode;
  at: number;
  gain: number;
  detune: number;
}

/**
 * The voices. Each is scheduled ahead of `at` and cleans itself up, so playing
 * one is fire-and-forget.
 */
export const VOICES = {
  cast({ context, destination, at, gain, detune }: VoiceContext) {
    tone(context, destination, { type: 'triangle', from: 280, to: 760, at, duration: 0.16, peak: gain * 0.5, detune });
    tone(context, destination, { type: 'sine', from: 560, to: 1520, at, duration: 0.12, peak: gain * 0.22, detune });
    burst(context, destination, { at, duration: 0.14, peak: gain * 0.16, frequency: 2600, q: 0.7, type: 'highpass' });
  },

  impact({ context, destination, at, gain, detune }: VoiceContext) {
    burst(context, destination, { at, duration: 0.09, peak: gain * 0.6, frequency: 1400, q: 0.9 });
    tone(context, destination, { type: 'sine', from: 170, to: 70, at, duration: 0.12, peak: gain * 0.7, detune });
  },

  /** The same hit, opened up: brighter, longer, with a metallic ring on top. */
  crit({ context, destination, at, gain, detune }: VoiceContext) {
    burst(context, destination, { at, duration: 0.13, peak: gain * 0.7, frequency: 2400, q: 0.6 });
    tone(context, destination, { type: 'sine', from: 220, to: 62, at, duration: 0.2, peak: gain * 0.85, detune });
    tone(context, destination, { type: 'square', from: 1760, to: 2640, at: at + 0.015, duration: 0.24, peak: gain * 0.16, detune });
    tone(context, destination, { type: 'triangle', from: 880, to: 1320, at: at + 0.03, duration: 0.3, peak: gain * 0.12, detune });
  },

  /** A spell effect going off: wider and boomier than a projectile landing. */
  blast({ context, destination, at, gain, detune }: VoiceContext) {
    burst(context, destination, { at, duration: 0.22, peak: gain * 0.5, frequency: 700, q: 0.5 });
    tone(context, destination, { type: 'sine', from: 140, to: 48, at, duration: 0.34, peak: gain * 0.8, detune });
    tone(context, destination, { type: 'triangle', from: 420, to: 130, at, duration: 0.18, peak: gain * 0.3, detune });
  },

  /** A whistle down and then the ground arriving. */
  meteor({ context, destination, at, gain, detune }: VoiceContext) {
    tone(context, destination, { type: 'sine', from: 1400, to: 280, at: at - 0.12, duration: 0.14, peak: gain * 0.28, detune });
    tone(context, destination, { type: 'sine', from: 120, to: 40, at, duration: 0.5, peak: gain * 0.95, detune });
    burst(context, destination, { at, duration: 0.4, peak: gain * 0.55, frequency: 420, q: 0.4 });
    burst(context, destination, { at: at + 0.03, duration: 0.5, peak: gain * 0.2, frequency: 3000, q: 0.6, type: 'highpass' });
  },

  /** The build's power states turning over: a rising, ringing sweep. */
  surge({ context, destination, at, gain, detune }: VoiceContext) {
    tone(context, destination, { type: 'sawtooth', from: 180, to: 1080, at, duration: 0.42, peak: gain * 0.32, detune });
    tone(context, destination, { type: 'sine', from: 270, to: 1620, at: at + 0.04, duration: 0.4, peak: gain * 0.24, detune });
    burst(context, destination, { at, duration: 0.36, peak: gain * 0.16, frequency: 2400, q: 0.8, type: 'highpass' });
  },

  /** A cast timed exactly right. Small, bright, and unmistakable. */
  perfect({ context, destination, at, gain, detune }: VoiceContext) {
    tone(context, destination, { type: 'sine', from: 2093, at, duration: 0.34, peak: gain * 0.3, detune });
    tone(context, destination, { type: 'sine', from: 3136, at: at + 0.01, duration: 0.26, peak: gain * 0.18, detune });
  },

  kill({ context, destination, at, gain, detune }: VoiceContext) {
    tone(context, destination, { type: 'sawtooth', from: 420, to: 120, at, duration: 0.26, peak: gain * 0.35, detune });
    burst(context, destination, { at, duration: 0.18, peak: gain * 0.2, frequency: 900, q: 0.5 });
  },

  bossKill({ context, destination, at, gain, detune }: VoiceContext) {
    tone(context, destination, { type: 'sawtooth', from: 300, to: 55, at, duration: 0.9, peak: gain * 0.5, detune });
    tone(context, destination, { type: 'triangle', from: 1320, to: 660, at: at + 0.05, duration: 1.1, peak: gain * 0.18, detune });
    burst(context, destination, { at, duration: 0.7, peak: gain * 0.22, frequency: 500, q: 0.4 });
  },

  enemyAttack({ context, destination, at, gain, detune }: VoiceContext) {
    tone(context, destination, { type: 'sine', from: 120, to: 58, at, duration: 0.14, peak: gain * 0.7, detune });
    burst(context, destination, { at, duration: 0.07, peak: gain * 0.3, frequency: 620, q: 1.2 });
  },

  defeat({ context, destination, at, gain, detune }: VoiceContext) {
    tone(context, destination, { type: 'sawtooth', from: 220, to: 46, at, duration: 1.4, peak: gain * 0.45, detune });
    tone(context, destination, { type: 'sine', from: 110, to: 40, at: at + 0.08, duration: 1.6, peak: gain * 0.35, detune });
  },

  levelUp({ context, destination, at, gain, detune }: VoiceContext) {
    tone(context, destination, { type: 'triangle', from: 660, at, duration: 0.1, peak: gain * 0.4, detune });
    tone(context, destination, { type: 'triangle', from: 990, at: at + 0.07, duration: 0.14, peak: gain * 0.36, detune });
  },

  awaken({ context, destination, at, gain, detune }: VoiceContext) {
    for (const [index, ratio] of [1, 1.5, 2, 3].entries()) {
      tone(context, destination, {
        type: 'sine',
        from: 440 * ratio,
        at: at + index * 0.035,
        duration: 0.8 - index * 0.1,
        peak: (gain * 0.3) / (index + 1),
        detune,
      });
    }
  },

  advance({ context, destination, at, gain, detune }: VoiceContext) {
    for (const [index, offset] of [0, 4, 7].entries()) {
      tone(context, destination, {
        type: 'triangle',
        from: semitones(440, offset),
        at: at + index * 0.06,
        duration: 0.3,
        peak: gain * 0.3,
        detune,
      });
    }
  },

  rebirth({ context, destination, at, gain, detune }: VoiceContext) {
    tone(context, destination, { type: 'sawtooth', from: 110, to: 880, at, duration: 1.6, peak: gain * 0.3, detune });
    tone(context, destination, { type: 'sine', from: 220, to: 1760, at: at + 0.1, duration: 1.5, peak: gain * 0.22, detune });
    burst(context, destination, { at: at + 0.2, duration: 1.2, peak: gain * 0.18, frequency: 3200, q: 0.5, type: 'highpass' });
  },
} as const;

export type VoiceKey = keyof typeof VOICES;
