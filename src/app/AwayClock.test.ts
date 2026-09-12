import { describe, expect, it } from 'vitest';
import { AwayClock, AWAY_CLOCK_KEY, type ClockStorage } from './AwayClock';

/** A Storage-shaped object, so none of this needs a browser. */
function fakeStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  const storage: ClockStorage & { peek(): string | null; wipe(): void } = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    peek: () => data.get(AWAY_CLOCK_KEY) ?? null,
    wipe: () => data.delete(AWAY_CLOCK_KEY),
  };
  return storage;
}

const DAY = 24 * 3600;
const HOUR = 3600;

const T0 = new Date('2026-01-01T00:00:00Z').getTime();

/**
 * A clock whose "now" the test drives, in seconds from T0 rather than in
 * milliseconds - the units the class works in are exactly where an off-by-1000
 * hides, and no test body below should have to think about them.
 */
function clockAt(storage = fakeStorage()) {
  let now = T0;
  return {
    storage,
    /** Move the clock to this many seconds after T0, forwards or backwards. */
    at: (seconds: number) => void (now = T0 + seconds * 1000),
    advance: (seconds: number) => void (now += seconds * 1000),
    build: () => new AwayClock(storage, DAY, AWAY_CLOCK_KEY, () => now),
  };
}

describe('AwayClock', () => {
  it('credits an ordinary absence in full', () => {
    const rig = clockAt();
    const clock = rig.build();
    clock.claim(T0);

    rig.advance(8 * HOUR);
    expect(rig.build().claim(T0)).toBeCloseTo(8 * HOUR, 0);
  });

  it('caps a single absence at the offline ceiling', () => {
    const rig = clockAt();
    rig.advance(30 * DAY);
    expect(rig.build().claim(T0)).toBe(DAY);
  });

  it('credits nothing for a stamp in the future', () => {
    const rig = clockAt();
    expect(rig.build().claim(T0 + 10 * DAY * 1000)).toBe(0);
  });

  /**
   * The exploit the whole class exists for. Before the high-water mark, this
   * loop paid a day per iteration, for as many iterations as anyone cared to
   * run.
   */
  it('pays a forward clock jump once, and never again', () => {
    const rig = clockAt();
    rig.build().claim(T0);

    // Jump a day forward: indistinguishable from a day away, so it pays.
    rig.advance(DAY);
    expect(rig.build().claim(T0)).toBe(DAY);

    // Now put the clock back where it started and try to farm the difference.
    rig.at(0);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(rig.build().claim(T0), `attempt ${attempt}`).toBe(0);
    }

    // It stays worthless until real time catches up with what was taken: the
    // day was not minted, it was spent in advance.
    rig.at(DAY - HOUR);
    expect(rig.build().claim(T0)).toBe(0);
    rig.at(DAY + HOUR);
    expect(rig.build().claim(T0)).toBeCloseTo(HOUR, 0);
  });

  it('pays nothing for rolling the clock backwards', () => {
    const rig = clockAt();
    rig.build().claim(T0);
    rig.at(-100 * DAY);
    expect(rig.build().claim(T0 - 100 * DAY * 1000)).toBe(0);
  });

  /**
   * The save's stamp is the other half of the old exploit: a backdated
   * `savedAt` used to be worth a day without touching the clock at all.
   */
  it('ignores a backdated save stamp', () => {
    const rig = clockAt();
    rig.build().claim(T0);

    rig.advance(60);
    // The blob claims it was written a year ago; only the minute is real.
    expect(rig.build().claim(T0 - 365 * DAY * 1000)).toBeCloseTo(60, 0);
  });

  it('never lowers the mark, whatever it is handed', () => {
    const rig = clockAt();
    const clock = rig.build();
    clock.claim(T0);
    const mark = clock.highWaterMark();

    clock.observe(T0 - 10 * DAY * 1000);
    clock.observe(Number.NaN);
    clock.observe(Number.NEGATIVE_INFINITY);
    expect(clock.highWaterMark()).toBe(mark);
  });

  it('survives a corrupt or missing key without crediting a fresh day', () => {
    for (const corrupt of ['', 'tomorrow', '-1', 'NaN', 'Infinity']) {
      const rig = clockAt(fakeStorage({ [AWAY_CLOCK_KEY]: corrupt }));
      // Falls back to the save's own stamp as the floor, which is the pre-mark
      // behaviour: no worse than before, and still bounded by the ceiling.
      expect(rig.build().claim(T0), corrupt).toBe(0);
    }
  });

  /**
   * Clearing the key is the one move that gets the mark out of the way, so it
   * is worth being explicit that it buys a player nothing they did not already
   * have: the save's stamp is still a floor, and it is covered by the save's
   * digest.
   */
  it('falls back to the save stamp when its key is wiped', () => {
    const rig = clockAt();
    rig.build().claim(T0);
    rig.advance(10 * DAY);
    rig.build().claim(T0);

    rig.storage.wipe();
    rig.at(0);
    // The clock is back at T0 and the mark is gone, but the save still says it
    // was written at T0, so there is no absence to claim.
    expect(rig.build().claim(T0)).toBe(0);
  });

  it('works without storage at all', () => {
    let now = T0;
    const clock = new AwayClock(null, DAY, AWAY_CLOCK_KEY, () => now);
    clock.claim(T0);
    now += HOUR * 1000;
    expect(clock.claim(T0)).toBeCloseTo(HOUR, 0);
  });

  /**
   * The bound this class actually promises, stated as a test.
   *
   * Not "credit is capped" - each reload may claim up to the ceiling, and
   * capping a lifetime total would eventually stop paying a player who really
   * does play daily. The promise is that no second is ever credited twice: the
   * total can never exceed the span of clock the installation has seen, so
   * every day taken early is a day not available later.
   */
  it('never credits a second twice, however the clock is abused', () => {
    const rig = clockAt();
    const clock = rig.build();
    const start = (clock.claim(T0), clock.highWaterMark());

    let credited = 0;
    // A deliberately hostile sequence: forward jumps to farm, backward ones to
    // try to reset, repeated toggles to try to farm the same hour twice.
    for (const jump of [DAY, -DAY, 3 * DAY, -5 * DAY, DAY, DAY, -2 * DAY, 10 * DAY, -10 * DAY]) {
      rig.advance(jump);
      credited += clock.claim(T0);
    }

    const spanSeen = (clock.highWaterMark() - start) / 1000;
    expect(credited).toBeLessThanOrEqual(spanSeen);
    // And the toggling really was worthless: the mark sits at the furthest
    // reading, so the clock has to get back there before anything pays again.
    rig.at(0);
    expect(clock.claim(T0)).toBe(0);
  });
});
