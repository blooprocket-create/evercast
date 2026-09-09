import { describe, expect, it } from 'vitest';
import { VOICES_PER_SECOND, VOICE_MIN_GAP, VoiceThrottle } from './VoiceThrottle';

describe('VoiceThrottle', () => {
  it('lets the first of any voice through', () => {
    const throttle = new VoiceThrottle();
    expect(throttle.admit('impact', 0)).toBe(true);
    expect(throttle.admit('cast', 0)).toBe(true);
  });

  it('refuses a repeat inside the voice gap and allows it after', () => {
    const throttle = new VoiceThrottle();
    throttle.admit('impact', 1);
    expect(throttle.admit('impact', 1 + VOICE_MIN_GAP.impact * 0.5)).toBe(false);
    expect(throttle.admit('impact', 1 + VOICE_MIN_GAP.impact)).toBe(true);
  });

  it('throttles each voice on its own clock', () => {
    const throttle = new VoiceThrottle();
    throttle.admit('impact', 0);
    // A crit landing right behind an impact is the whole point of the crit.
    expect(throttle.admit('crit', 0.001)).toBe(true);
  });

  it('caps a frame-rate flood well below the batch arithmetic', () => {
    const throttle = new VoiceThrottle();
    let admitted = 0;
    // Ten cues a frame at 60fps: 600 attempts across one second.
    for (let frame = 0; frame < 60; frame += 1) {
      for (let cue = 0; cue < 10; cue += 1) {
        if (throttle.admit('impact', frame / 60 + cue * 0.0005)) admitted += 1;
      }
    }
    expect(admitted).toBeLessThanOrEqual(VOICES_PER_SECOND);
    expect(admitted).toBeGreaterThan(0);
  });

  it('opens the budget again in the next second', () => {
    const throttle = new VoiceThrottle();
    for (let i = 0; i < VOICES_PER_SECOND * 2; i += 1) throttle.admit('impact', i * 0.001);
    expect(throttle.admit('impact', 1.5)).toBe(true);
  });

  it('does not lock a voice out when the clock rewinds', () => {
    const throttle = new VoiceThrottle();
    throttle.admit('rebirth', 100);
    // A suspended context resumes with a lower currentTime than it left.
    expect(throttle.admit('rebirth', 2)).toBe(true);
  });

  it('forgets everything on reset', () => {
    const throttle = new VoiceThrottle();
    throttle.admit('defeat', 0);
    throttle.reset();
    expect(throttle.admit('defeat', 0)).toBe(true);
  });

  it('gives the one-off moments a longer gap than the combat chatter', () => {
    expect(VOICE_MIN_GAP.rebirth).toBeGreaterThan(VOICE_MIN_GAP.impact);
    expect(VOICE_MIN_GAP.bossKill).toBeGreaterThan(VOICE_MIN_GAP.kill);
  });
});
