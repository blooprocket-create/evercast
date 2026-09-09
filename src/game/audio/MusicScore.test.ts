import { describe, expect, it } from 'vitest';
import { ZONES } from '../../content/zones';
import {
  BEATS_PER_BAR,
  barArpeggio,
  barBass,
  barChord,
  barSeconds,
  degreeHz,
  moodFor,
} from './MusicScore';

describe('moodFor', () => {
  it('gives every zone its own mood', () => {
    const signatures = ZONES.map((_, index) => {
      const mood = moodFor(index + 1);
      return `${mood.root}:${mood.scale.join(',')}:${mood.beatsPerMinute}`;
    });
    expect(new Set(signatures).size).toBe(ZONES.length);
  });

  it('cycles rather than falling off the end of the road', () => {
    expect(moodFor(ZONES.length + 1)).toEqual(moodFor(1));
    expect(moodFor(0)).toEqual(moodFor(1));
    expect(moodFor(-3)).toBeDefined();
  });

  it('keeps a boss in the same place, only darker and faster', () => {
    for (let zone = 1; zone <= ZONES.length; zone += 1) {
      const calm = moodFor(zone);
      const boss = moodFor(zone, true);
      expect(boss.root).toBe(calm.root);
      expect(boss.beatsPerMinute).toBeGreaterThan(calm.beatsPerMinute);
      // A minor third above the tonic is what makes it read as dark.
      expect(boss.scale[2]).toBe(3);
    }
  });
});

describe('pitches', () => {
  it('puts a full scale inside one octave', () => {
    const mood = moodFor(1);
    const octave = degreeHz(mood, mood.scale.length) / mood.root;
    expect(octave).toBeCloseTo(2, 6);
  });

  it('climbs monotonically with the degree', () => {
    const mood = moodFor(3);
    let previous = 0;
    for (let degree = 0; degree < 16; degree += 1) {
      const hz = degreeHz(mood, degree);
      expect(hz).toBeGreaterThan(previous);
      previous = hz;
    }
  });

  it('voices a chord as root, third and fifth', () => {
    const mood = moodFor(2);
    for (let bar = 0; bar < 8; bar += 1) {
      const chord = barChord(mood, bar);
      expect(chord).toHaveLength(3);
      expect(chord[0]).toBeLessThan(chord[1]!);
      expect(chord[1]).toBeLessThan(chord[2]!);
    }
  });
});

describe('bars', () => {
  const mood = moodFor(4);

  it('is the same length whichever bar it is', () => {
    expect(barSeconds(mood)).toBeCloseTo((60 / mood.beatsPerMinute) * BEATS_PER_BAR, 9);
  });

  it('keeps every note inside its bar', () => {
    for (const intensity of [0, 0.5, 1]) {
      const notes = [...barArpeggio(mood, 3, intensity), ...barBass(mood, 3, intensity)];
      for (const note of notes) {
        expect(note.beat).toBeGreaterThanOrEqual(0);
        expect(note.beat).toBeLessThan(BEATS_PER_BAR);
        expect(note.gain).toBeGreaterThan(0);
      }
    }
  });

  it('opens the part up under pressure instead of only turning it up', () => {
    const calm = barArpeggio(mood, 0, 0);
    const fighting = barArpeggio(mood, 0, 1);
    expect(fighting.length).toBeGreaterThan(calm.length);
    expect(Math.max(...fighting.map((n) => n.hz))).toBeGreaterThan(
      Math.max(...calm.map((n) => n.hz)),
    );
  });

  it('treats an out-of-range intensity as its nearest end', () => {
    expect(barBass(mood, 1, 4)).toEqual(barBass(mood, 1, 1));
    expect(barBass(mood, 1, -2)).toEqual(barBass(mood, 1, 0));
  });

  it('repeats the progression rather than wandering off', () => {
    const period = mood.progression.length;
    expect(barChord(mood, period * 3)).toEqual(barChord(mood, 0));
  });
});
