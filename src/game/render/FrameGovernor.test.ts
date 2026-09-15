import { describe, expect, it } from 'vitest';
import { FrameGovernor, type GovernorSettings } from './FrameGovernor';

const SETTINGS: GovernorSettings = { target: 60, base: 1, floor: 1, ceiling: 1.6 };

/** Feeds `seconds` of frames at a steady rate and reports every change made. */
function run(governor: FrameGovernor, fps: number, seconds: number): number[] {
  const frameMs = 1000 / fps;
  const changes: number[] = [];
  for (let elapsed = 0; elapsed < seconds * 1000; elapsed += frameMs) {
    const next = governor.sample(frameMs);
    if (next !== null) changes.push(+next.toFixed(2));
  }
  return changes;
}

describe('a device that is keeping up', () => {
  it('is left entirely alone', () => {
    const governor = new FrameGovernor(SETTINGS);
    expect(run(governor, 60, 30)).toEqual([]);
    expect(governor.scaling).toBe(1);
  });

  it('is not moved by one bad frame in a good minute', () => {
    const governor = new FrameGovernor(SETTINGS);
    for (let i = 0; i < 3600; i++) governor.sample(i % 600 === 0 ? 90 : 1000 / 60);
    expect(governor.scaling).toBe(1);
  });
});

describe('a device that is not keeping up', () => {
  it('trades resolution away, one step at a time, up to the ceiling', () => {
    const governor = new FrameGovernor(SETTINGS);
    const changes = run(governor, 34, 20);
    expect(changes.length).toBeGreaterThan(1);
    // Every step is a step down in resolution, and never past the ceiling.
    for (let i = 1; i < changes.length; i++) expect(changes[i]).toBeGreaterThan(changes[i - 1]);
    expect(governor.scaling).toBeCloseTo(SETTINGS.ceiling, 5);
  });

  it('takes more than one window to decide', () => {
    const governor = new FrameGovernor(SETTINGS);
    // A second of trouble is a hiccup; the window is longer than that on purpose.
    expect(run(governor, 34, 1)).toEqual([]);
  });

  it('gives resolution back once it recovers, and does not immediately retake it', () => {
    const governor = new FrameGovernor(SETTINGS);
    run(governor, 30, 20);
    const struggling = governor.scaling;
    expect(struggling).toBeGreaterThan(1);

    const recovered = run(governor, 60, 20);
    expect(recovered.length).toBeGreaterThan(0);
    expect(governor.scaling).toBeLessThan(struggling);
    // Each step back up waits out the settle, so a twenty-second recovery is a
    // handful of steps rather than a slide straight back to the floor.
    for (let i = 1; i < recovered.length; i++) expect(recovered[i]).toBeLessThan(recovered[i - 1]);
  });

  it('never oscillates when the frame rate sits exactly on the boundary', () => {
    const governor = new FrameGovernor(SETTINGS);
    // 0.86 of target is the line. Sitting just above it is the case that used
    // to thrash: good enough not to drop, close enough to look like trouble.
    const changes = run(governor, 60 * 0.9, 60);
    expect(changes).toEqual([]);
  });
});

describe('a frame that was not a frame', () => {
  it('ignores the stall of a tab coming back', () => {
    const governor = new FrameGovernor(SETTINGS);
    for (let i = 0; i < 400; i++) governor.sample(1000 / 60);
    governor.sample(45_000);
    for (let i = 0; i < 400; i++) governor.sample(1000 / 60);
    expect(governor.scaling).toBe(1);
  });

  it('ignores a zero and a NaN rather than dividing by them', () => {
    const governor = new FrameGovernor(SETTINGS);
    expect(governor.sample(0)).toBeNull();
    expect(governor.sample(Number.NaN)).toBeNull();
    expect(governor.sample(-16)).toBeNull();
    expect(governor.scaling).toBe(1);
  });
});

describe('retargeting', () => {
  it('keeps the resolution already reached - the device did not get faster', () => {
    const governor = new FrameGovernor(SETTINGS);
    run(governor, 30, 20);
    const reached = governor.scaling;
    governor.retarget({ ...SETTINGS, target: 30 });
    expect(governor.scaling).toBe(reached);
  });

  it('measures against the new target from the next window on', () => {
    const governor = new FrameGovernor(SETTINGS);
    governor.retarget({ ...SETTINGS, target: 30 });
    // Thirty frames is failure against sixty and comfort against thirty.
    expect(run(governor, 30, 20)).toEqual([]);
  });

  it('pulls the level back inside a range that no longer contains it', () => {
    const governor = new FrameGovernor(SETTINGS);
    run(governor, 30, 20);
    expect(governor.scaling).toBeGreaterThan(1.2);
    governor.retarget({ target: 60, base: 1, floor: 1, ceiling: 1.2 });
    expect(governor.scaling).toBe(1.2);
  });
});
