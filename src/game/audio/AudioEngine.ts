import type { GameEvent } from '../../engine/events/GameEvent';
import type { SimulationSnapshot } from '../../engine/types';
import { planAudio, type VoiceName } from './AudioCuePlan';
import {
  BEATS_PER_BAR,
  barArpeggio,
  barBass,
  barChord,
  barSeconds,
  moodFor,
  type MusicMood,
} from './MusicScore';
import { VOICES, tone } from './Voices';
import { VoiceThrottle } from './VoiceThrottle';

/**
 * The one place that touches WebAudio.
 *
 * Structurally the same shape as `AudioSettings` in the app layer, restated
 * here so `src/game` never has to import from `src/app` - the same direction
 * `VfxQuality` already runs in.
 */
export interface AudioMix {
  master: number;
  music: number;
  effects: number;
  muted: boolean;
}

const SILENT_MIX: AudioMix = { master: 0, music: 0, effects: 0, muted: true };

/** How far ahead the music scheduler writes, and how often it wakes up. */
const LOOKAHEAD_SECONDS = 0.4;
const SCHEDULER_MS = 90;

/** Sliders are linear; ears are not. */
const perceived = (value: number) => Math.pow(Math.min(1, Math.max(0, value)), 1.6);

/**
 * A short synthesised hall. A real impulse response would be a binary asset
 * with a licence; exponentially decaying noise is a fraction of the character
 * and none of the paperwork, and at this send level the difference is
 * inaudible under combat.
 */
function impulseResponse(context: AudioContext, seconds: number, decay: number): AudioBuffer {
  const length = Math.floor(context.sampleRate * seconds);
  const buffer = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return buffer;
}

export interface SceneMood {
  zone: number;
  boss: boolean;
  /** 0 while travelling, 1 mid-fight. */
  intensity: number;
}

/**
 * What the music should be feeling, read off the snapshot.
 *
 * Travel is not silence - it is the same music with the pressure off - so the
 * floor is well above zero. A crowd counts for more than a single straggler,
 * which is what makes clearing a wave audibly wind down.
 */
export function sceneMoodFor(
  snapshot: Pick<SimulationSnapshot, 'zone' | 'boss' | 'phase' | 'encounterAliveEnemies'>,
): SceneMood {
  const fighting = snapshot.phase === 'combat';
  const crowd = Math.min(0.4, Math.max(0, snapshot.encounterAliveEnemies) * 0.12);
  const intensity = snapshot.boss ? 1 : fighting ? 0.45 + crowd : 0.12;
  return { zone: snapshot.zone, boss: snapshot.boss, intensity };
}

export class AudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private effectsBus: GainNode | null = null;
  private reverbSend: GainNode | null = null;

  private readonly throttle = new VoiceThrottle();
  /** Which live enemies are bosses; only their spawn event ever says so. */
  private readonly bossIds = new Set<number>();
  private mix: AudioMix = SILENT_MIX;

  private mood: MusicMood = moodFor(1);
  private scene: SceneMood = { zone: 1, boss: false, intensity: 0 };
  private intensity = 0;
  private bar = 0;
  private nextBarAt = 0;
  private scheduler: number | null = null;
  private detach: (() => void) | null = null;

  get running(): boolean {
    return this.context !== null;
  }

  /**
   * Browsers refuse to start audio without a gesture, so the context is built
   * on the player's first click or key rather than at boot. Everything before
   * that point is a silent no-op, which is also exactly what happens in tests
   * and on the server, where there is no `AudioContext` at all.
   */
  start(): void {
    if (this.detach || typeof window === 'undefined') return;

    const unlock = () => {
      this.detach?.();
      this.detach = null;
      this.build();
    };

    const events = ['pointerdown', 'keydown', 'touchstart'] as const;
    for (const event of events) window.addEventListener(event, unlock, { once: true });
    this.detach = () => {
      for (const event of events) window.removeEventListener(event, unlock);
    };
  }

  private build(): void {
    const Constructor =
      typeof AudioContext !== 'undefined'
        ? AudioContext
        : (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Constructor) return;

    const context = new Constructor();
    // Catches the peaks a crit stack makes without flattening ordinary hits.
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 12;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.18;

    const master = context.createGain();
    const musicBus = context.createGain();
    const effectsBus = context.createGain();
    const reverb = context.createConvolver();
    const reverbSend = context.createGain();
    const reverbReturn = context.createGain();

    reverb.buffer = impulseResponse(context, 1.6, 2.4);
    reverbSend.gain.value = 0.32;
    reverbReturn.gain.value = 0.5;

    master.gain.value = 0;
    musicBus.gain.value = 0;
    effectsBus.gain.value = 0;

    musicBus.connect(master);
    effectsBus.connect(master);
    effectsBus.connect(reverbSend);
    musicBus.connect(reverbSend);
    reverbSend.connect(reverb).connect(reverbReturn).connect(master);
    master.connect(limiter).connect(context.destination);

    this.context = context;
    this.master = master;
    this.musicBus = musicBus;
    this.effectsBus = effectsBus;
    this.reverbSend = reverbSend;

    this.applyMix();
    this.mood = moodFor(this.scene.zone, this.scene.boss);
    this.nextBarAt = context.currentTime + 0.15;
    this.scheduler = window.setInterval(() => this.scheduleAhead(), SCHEDULER_MS);
  }

  setMix(mix: AudioMix): void {
    this.mix = mix;
    this.applyMix();
  }

  private applyMix(): void {
    const context = this.context;
    if (!context || !this.master || !this.musicBus || !this.effectsBus) return;

    const now = context.currentTime;
    const level = this.mix.muted ? 0 : perceived(this.mix.master);
    // A time constant rather than a jump, so dragging a slider does not click.
    this.master.gain.setTargetAtTime(level, now, 0.04);
    this.musicBus.gain.setTargetAtTime(perceived(this.mix.music) * 0.9, now, 0.04);
    this.effectsBus.gain.setTargetAtTime(perceived(this.mix.effects) * 0.8, now, 0.04);
  }

  setScene(scene: SceneMood): void {
    this.scene = scene;
  }

  /** Consumes one batch of presentation events. Safe before the first gesture. */
  handleEvents(events: readonly GameEvent[]): void {
    if (events.length === 0) return;
    // Tracked before the silence guards: a boss spawned while muted still has
    // to be recognised as a boss when it dies after the sound comes back.
    for (const event of events) {
      if (event.type === 'enemy_spawned' && event.boss) this.bossIds.add(event.instanceId);
    }

    const context = this.context;
    const playable = context && this.effectsBus && !this.mix.muted;
    const cues = playable ? planAudio(events, (id) => this.bossIds.has(id)) : [];

    for (const event of events) {
      if (event.type === 'enemy_killed') this.bossIds.delete(event.instanceId);
    }
    if (!context || !this.effectsBus) return;

    const now = context.currentTime;
    for (const cue of cues) {
      const at = now + cue.at;
      if (!this.throttle.admit(cue.voice, at)) continue;
      VOICES[cue.voice]({
        context,
        destination: this.effectsBus,
        at,
        gain: cue.gain,
        detune: cue.detune,
      });
    }
  }

  /**
   * Plays one voice on the effects bus, on demand.
   *
   * A volume slider that can only prove itself mid-fight is a slider nobody can
   * set: the settings screen is covering the game while you drag it, so there
   * is nothing to hear. This takes the same path a combat cue does - same bus,
   * same mix - so what you audition is what the fight will sound like.
   *
   * Deliberately outside the throttle, which exists to keep a wide build from
   * melting the audio thread. A press that lands within the 45ms an impact is
   * held off for would be dropped in silence, which from the far side of a
   * button reads as a broken control - and one voice per press is a rate no
   * hand can push anywhere near the ceiling anyway.
   */
  preview(voice: VoiceName = 'impact'): void {
    const context = this.context;
    if (!context || !this.effectsBus || this.mix.muted) return;

    // Scheduled a beat ahead rather than at `currentTime`, which a busy thread
    // can leave already in the past - a voice starting late begins mid-envelope
    // and clicks.
    const at = context.currentTime + 0.02;
    VOICES[voice]({ context, destination: this.effectsBus, at, gain: 0.6, detune: 0 });
  }

  /**
   * Writes every bar that starts inside the lookahead window. Mood and
   * intensity are only ever read here, so a zone change lands on the next bar
   * line instead of cutting the current one in half.
   */
  private scheduleAhead(): void {
    const context = this.context;
    if (!context || !this.musicBus || this.mix.muted || this.mix.music <= 0) return;

    const horizon = context.currentTime + LOOKAHEAD_SECONDS;
    // A resumed context can leave the clock far ahead of the last bar written.
    if (this.nextBarAt < context.currentTime) this.nextBarAt = context.currentTime + 0.05;

    let guard = 0;
    while (this.nextBarAt < horizon && guard < 8) {
      this.mood = moodFor(this.scene.zone, this.scene.boss);
      this.intensity += (this.scene.intensity - this.intensity) * 0.34;
      this.scheduleBar(context, this.musicBus, this.nextBarAt);
      this.nextBarAt += barSeconds(this.mood);
      this.bar += 1;
      guard += 1;
    }
  }

  private scheduleBar(context: AudioContext, bus: AudioNode, at: number): void {
    const mood = this.mood;
    const beat = 60 / mood.beatsPerMinute;
    const length = beat * BEATS_PER_BAR;

    // The pad: one long chord under everything. It deliberately outlives its
    // own bar - a chord that ends when the bar ends leaves a hole while the
    // next one is still swelling in, which reads as the music pumping once per
    // bar line. Holding to the bar end and releasing into the next bar's
    // attack makes the two overlap into a crossfade instead.
    for (const [index, hz] of barChord(mood, this.bar).entries()) {
      tone(context, bus, {
        type: mood.padWave,
        from: hz,
        at,
        duration: length * 1.35,
        peak: (0.3 - index * 0.05) * (0.75 + this.intensity * 0.25),
        attack: length * 0.3,
        hold: length * 0.7,
      });
    }

    for (const note of barBass(mood, this.bar, this.intensity)) {
      tone(context, bus, {
        type: 'triangle',
        from: note.hz,
        at: at + note.beat * beat,
        duration: note.duration * beat,
        peak: note.gain,
        attack: 0.02,
        hold: note.duration * beat * 0.3,
      });
    }

    for (const note of barArpeggio(mood, this.bar, this.intensity)) {
      tone(context, bus, {
        type: mood.leadWave,
        from: note.hz,
        at: at + note.beat * beat,
        duration: note.duration * beat,
        peak: note.gain * 0.6,
        attack: 0.01,
      });
    }
  }

  /** Tabbing away should not leave a bar playing to an empty room. */
  setSuspended(suspended: boolean): void {
    const context = this.context;
    if (!context) return;
    if (suspended && context.state === 'running') void context.suspend();
    if (!suspended && context.state === 'suspended') {
      void context.resume().then(() => {
        this.nextBarAt = context.currentTime + 0.05;
        this.throttle.reset();
      });
    }
  }

  dispose(): void {
    this.detach?.();
    this.detach = null;
    if (this.scheduler !== null) window.clearInterval(this.scheduler);
    this.scheduler = null;
    void this.context?.close();
    this.context = null;
    this.master = null;
    this.musicBus = null;
    this.effectsBus = null;
    this.reverbSend = null;
    this.throttle.reset();
    this.bossIds.clear();
  }
}
