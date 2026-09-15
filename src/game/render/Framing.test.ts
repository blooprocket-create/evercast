import { describe, expect, it } from 'vitest';
import { FORMATION_ROWS } from '../../engine/companions/types';
import { formationPosition } from '../../engine/companions/Formation';
import { formationSlot } from '../../engine/combat/SpellCombatState';
import {
  BASE_BETA,
  BASE_FOV,
  BASE_TARGET_X,
  FIGHT_MAX_X,
  FIGHT_MIN_X,
  framingFor,
  visibleSpan,
} from './Framing';

/** The shapes the game is actually played in. */
const ASPECTS = {
  'desktop 1920x1080': 1920 / 1080,
  'desktop 1440x900': 1440 / 900,
  'laptop 1280x800': 1280 / 800,
  'narrow 1024x768': 1024 / 768,
  'tablet landscape 1180x820': 1180 / 820,
  'tablet portrait 820x1180': 820 / 1180,
  'phone portrait 390x844': 390 / 844,
  'phone portrait 360x800': 360 / 800,
  'phone portrait 320x568': 320 / 568,
  'phone landscape 844x390': 844 / 390,
  'phone landscape 568x320': 568 / 320,
};

/** Where the mage stands across the frame, 0 at the left edge and 1 at the right. */
function mageAcrossFrame(aspect: number): number {
  const framing = framingFor(aspect);
  const { width } = visibleSpan(framing, aspect);
  return (0 - (framing.targetX - width / 2)) / width;
}

describe('where the party stands in the frame', () => {
  it('is left of centre at every shape the game is played in', () => {
    for (const [name, aspect] of Object.entries(ASPECTS)) {
      const across = mageAcrossFrame(aspect);
      // Left of centre, and not so far left that the party falls off the edge.
      expect(across, name).toBeLessThan(0.42);
      expect(across, name).toBeGreaterThan(0.2);
    }
  });

  it('puts a landscape window within a few percent of where a phone puts it', () => {
    // The two used to disagree by thirteen points of frame width, which is the
    // whole of what the aim was changed for.
    const desktop = mageAcrossFrame(16 / 9);
    const phone = mageAcrossFrame(390 / 844);
    expect(Math.abs(desktop - phone)).toBeLessThan(0.05);
  });

  it('leaves more road ahead of the party than behind it', () => {
    // The road ahead is where the enemies arrive from and where the haze does
    // its work; the space behind the back rank is only ever spare frame.
    const framing = framingFor(16 / 9);
    const { width } = visibleSpan(framing, 16 / 9);
    const behind = FIGHT_MIN_X - (framing.targetX - width / 2);
    const ahead = framing.targetX + width / 2 - FIGHT_MAX_X;
    expect(ahead).toBeGreaterThan(behind);
  });
});

describe('the fight fits the frame', () => {
  it.each(Object.entries(ASPECTS))('at %s', (_name, aspect) => {
    const framing = framingFor(aspect);
    const { width } = visibleSpan(framing, aspect);
    const left = framing.targetX - width / 2;
    const right = framing.targetX + width / 2;
    expect(left).toBeLessThanOrEqual(FIGHT_MIN_X + 1e-6);
    expect(right).toBeGreaterThanOrEqual(FIGHT_MAX_X - 1e-6);
  });

  it('spans everything that actually stands on the road', () => {
    // The two ends are read from the content rather than trusted: a companion
    // row or a contact slot moved without moving these is a frame that cuts
    // somebody off.
    const party = FORMATION_ROWS.flatMap((row) =>
      [0, 1, 2, 3, 4].map((index) => formationPosition(row, index).x),
    );
    const contacts = [0, 1, 2, 3, 4, 5].map((index) => formationSlot(index).x);
    expect(FIGHT_MIN_X).toBeLessThanOrEqual(Math.min(...party, ...contacts));
    expect(FIGHT_MAX_X).toBeGreaterThanOrEqual(Math.max(...party, ...contacts));
    // Half a body of air at each end, not a hairline.
    expect(Math.min(...party) - FIGHT_MIN_X).toBeGreaterThan(0.3);
    expect(FIGHT_MAX_X - Math.max(...contacts)).toBeGreaterThan(0.3);
  });
});

describe('the authored shot', () => {
  it('is left exactly alone on anything landscape', () => {
    for (const [name, aspect] of Object.entries(ASPECTS)) {
      if (aspect < 1.2) continue;
      const framing = framingFor(aspect);
      expect(framing.fov, name).toBe(BASE_FOV);
      expect(framing.targetX, name).toBe(BASE_TARGET_X);
      expect(framing.beta, name).toBe(BASE_BETA);
    }
  });

  it('is never narrowed, only widened', () => {
    for (let aspect = 0.3; aspect <= 3; aspect += 0.01) {
      expect(framingFor(aspect).fov).toBeGreaterThanOrEqual(BASE_FOV);
    }
  });
});

describe('a tall screen', () => {
  it('spends less of itself on nothing than the rule it replaces', () => {
    // The old rule held 11 units of width at any cost, and on a phone that
    // cost 23.8 units of height - most of it empty grass and sky, with the
    // mage about 40px tall inside it.
    const aspect = 390 / 844;
    const before = 2 * 17.5 * Math.tan(Math.max(BASE_FOV, 2 * Math.atan(11 / (35 * aspect))) / 2);
    const after = visibleSpan(framingFor(aspect), aspect).height;
    expect(before).toBeGreaterThan(23);
    expect(after).toBeLessThan(before * 0.85);
  });

  it('leans further over the road the taller it gets, and never past the limit', () => {
    const wide = framingFor(1.6).beta;
    const tablet = framingFor(820 / 1180).beta;
    const phone = framingFor(390 / 844).beta;
    expect(wide).toBe(BASE_BETA);
    expect(tablet).toBeLessThan(wide);
    expect(phone).toBeLessThanOrEqual(tablet);
    expect(phone).toBeGreaterThan(1);
  });

  it('gives up the composed aim and centres the fight, having no width to spare', () => {
    // A wide window can afford to stand the party off to one side; a phone
    // cannot, because the fight is very nearly as wide as the frame. So the aim
    // comes back to the middle of the fight - which still leaves the mage about
    // a third in from the left, because the fight reaches further right of him
    // than left.
    const phone = framingFor(390 / 844);
    expect(phone.targetX).toBeCloseTo((FIGHT_MIN_X + FIGHT_MAX_X) / 2, 5);
    expect(phone.targetX).toBeLessThan(BASE_TARGET_X);
  });
});

describe('a camera that is handed nonsense', () => {
  it('falls back to the authored shot rather than writing a broken one', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const framing = framingFor(bad);
      expect(framing.fov).toBe(BASE_FOV);
      expect(framing.targetX).toBe(BASE_TARGET_X);
      expect(framing.beta).toBe(BASE_BETA);
    }
  });
});
