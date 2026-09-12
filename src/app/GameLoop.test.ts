import { beforeEach, describe, expect, it, vi } from 'vitest';

type Frame = (now: number) => void;

/**
 * The smallest browser the loop needs, so this runs in node.
 *
 * `requestAnimationFrame` is a queue the test drains by hand rather than a
 * timer: the thing under test is whether the loop re-arms itself, and that is
 * only observable if nothing else is re-arming it. `cancelAnimationFrame` really
 * cancels, because whether teardown stops the loop is one of the claims here.
 */
function installBrowser() {
  const scheduled = new Map<number, Frame>();
  let nextHandle = 1;

  Object.assign(globalThis, {
    document: {
      hidden: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    window: {
      setInterval: () => 1,
      clearInterval: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    requestAnimationFrame: (callback: Frame) => {
      const handle = nextHandle++;
      scheduled.set(handle, callback);
      return handle;
    },
    cancelAnimationFrame: (handle: number) => void scheduled.delete(handle),
  });

  return {
    /** Runs the frames queued as of now, and returns how many ran. */
    tick(now: number): number {
      const due = [...scheduled.entries()];
      for (const [handle] of due) scheduled.delete(handle);
      for (const [, callback] of due) callback(now);
      return due.length;
    },
    armed: () => scheduled.size,
    reset: () => scheduled.clear(),
  };
}

const clock = installBrowser();
// Imported after the globals exist: `runtime` reaches for them as it evaluates.
const { startGameLoop } = await import('./GameLoop');

function sceneThat(sync: () => void) {
  return { sync: vi.fn(sync) } as unknown as Parameters<typeof startGameLoop>[0]['scene'];
}

describe('startGameLoop', () => {
  // Each loop is a separate session; a frame left over from the last one would
  // make "is it still armed?" meaningless.
  beforeEach(() => clock.reset());

  it('keeps itself armed across frames', () => {
    const scene = sceneThat(() => {});
    const stop = startGameLoop({ scene, onAwayProgress: () => {} });

    expect(clock.armed()).toBe(1);
    for (let frame = 1; frame <= 5; frame += 1) {
      expect(clock.tick(frame * 16)).toBe(1);
      expect(clock.armed()).toBe(1);
    }
    stop();
  });

  /**
   * The regression this file exists for. The loop re-arms at the end of its own
   * callback, so a frame that threw was never re-armed and the world stopped
   * advancing and drawing for good - and it did not look like an error, because
   * Babylon drives its own render loop and went on painting the last state while
   * React went on handling clicks. A frozen game with working menus.
   */
  it('survives a frame that throws, and says so once rather than every frame', () => {
    const failure = vi.spyOn(console, 'error').mockImplementation(() => {});
    const scene = sceneThat(() => {
      throw new Error('scene sync blew up');
    });
    const stop = startGameLoop({ scene, onAwayProgress: () => {} });

    for (let frame = 1; frame <= 20; frame += 1) {
      expect(clock.tick(frame * 16)).toBe(1);
      // Still armed, every time: the loop outlives the failure.
      expect(clock.armed()).toBe(1);
    }

    // Twenty failed frames, reported once - a wedged frame must not fill the
    // console sixty times a second and bury the first, useful trace.
    expect(scene.sync).toHaveBeenCalledTimes(20);
    expect(failure).toHaveBeenCalledTimes(1);
    expect(String(failure.mock.calls[0]?.[0])).toContain('frame failed');

    stop();
    failure.mockRestore();
  });

  it('recovers completely once a transient failure passes', () => {
    const failure = vi.spyOn(console, 'error').mockImplementation(() => {});
    let explode = true;
    const scene = sceneThat(() => {
      if (explode) throw new Error('one bad frame');
    });
    const stop = startGameLoop({ scene, onAwayProgress: () => {} });

    clock.tick(16);
    explode = false;
    for (let frame = 2; frame <= 4; frame += 1) clock.tick(frame * 16);

    expect(scene.sync).toHaveBeenCalledTimes(4);
    expect(failure).toHaveBeenCalledTimes(1);
    expect(clock.armed()).toBe(1);

    stop();
    failure.mockRestore();
  });

  /**
   * The backoff is per run of failures. Counted cumulatively, a second incident
   * would arrive with the counter already past one and be swallowed until the
   * six hundredth failure - losing the first trace of the incident that matters.
   */
  it('reports a later incident too, rather than backing off forever', () => {
    const failure = vi.spyOn(console, 'error').mockImplementation(() => {});
    let explode = true;
    const scene = sceneThat(() => {
      if (explode) throw new Error('this incident');
    });
    const stop = startGameLoop({ scene, onAwayProgress: () => {} });

    clock.tick(16);
    expect(failure).toHaveBeenCalledTimes(1);

    // Recover for a while, then fail again: a new incident, so a new report.
    explode = false;
    for (let frame = 2; frame <= 10; frame += 1) clock.tick(frame * 16);
    expect(failure).toHaveBeenCalledTimes(1);

    explode = true;
    clock.tick(11 * 16);
    expect(failure).toHaveBeenCalledTimes(2);
    expect(String(failure.mock.calls[1]?.[0])).toContain('(1x in a row)');

    stop();
    failure.mockRestore();
  });

  it('stops for good when torn down', () => {
    const scene = sceneThat(() => {});
    const stop = startGameLoop({ scene, onAwayProgress: () => {} });
    clock.tick(16);
    stop();
    // Whatever the teardown left queued must not keep the loop going.
    clock.tick(32);
    expect(clock.tick(48)).toBe(0);
  });
});
