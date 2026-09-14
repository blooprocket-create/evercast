import { describe, expect, it } from 'vitest';
import { big } from '../numbers';
import { RateMeter } from './RateMeter';

/** Runs the meter for `seconds`, earning `per` each second. */
function run(meter: RateMeter<'gold'>, seconds: number, per: string, step = 1): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += step) {
    meter.add('gold', big(per).mul(step));
    meter.tick(step);
  }
}

describe('the rate meter', () => {
  it('says nothing until it has watched long enough to know', () => {
    const meter = new RateMeter<'gold'>();
    expect(meter.read('gold')).toBeNull();
    run(meter, 2, '100');
    expect(meter.read('gold')).toBeNull();
    run(meter, 6, '100');
    expect(meter.read('gold')).not.toBeNull();
  });

  it('converges on the rate it is actually being fed', () => {
    const meter = new RateMeter<'gold'>();
    run(meter, 200, '1000');
    expect(meter.read('gold')!.toNumber()).toBeGreaterThan(950);
    expect(meter.read('gold')!.toNumber()).toBeLessThan(1050);
  });

  it('is not fooled by the size of the steps it is advanced in', () => {
    // The loop steps to the next event, not on a tick, so one kill can land on
    // a step of microseconds. Dividing by that step would read 1e60 a second.
    const coarse = new RateMeter<'gold'>();
    const fine = new RateMeter<'gold'>();
    run(coarse, 200, '500', 2);
    for (let elapsed = 0; elapsed < 200; elapsed += 0.001) {
      fine.add('gold', big('0.5'));
      fine.tick(0.001);
    }
    const a = coarse.read('gold')!.toNumber();
    const b = fine.read('gold')!.toNumber();
    expect(Math.abs(a - b) / a).toBeLessThan(0.05);
  });

  it('follows the run down as well as up', () => {
    const meter = new RateMeter<'gold'>();
    run(meter, 300, '1000');
    run(meter, 300, '10');
    expect(meter.read('gold')!.toNumber()).toBeLessThan(20);
  });

  it('holds numbers a double cannot', () => {
    const meter = new RateMeter<'gold'>();
    run(meter, 200, '1e400');
    const exponent = meter.read('gold')!.log10().toNumber();
    expect(exponent).toBeGreaterThan(399);
    expect(exponent).toBeLessThan(401);
  });

  it('reports nothing earned as nothing, not as undefined', () => {
    const meter = new RateMeter<'gold'>();
    for (let i = 0; i < 10; i += 1) meter.tick(1);
    expect(meter.read('gold')!.toNumber()).toBe(0);
  });

  it('ignores a step that is not a length of time', () => {
    const meter = new RateMeter<'gold'>();
    run(meter, 200, '100');
    const before = meter.read('gold')!.toString();
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) meter.tick(bad);
    expect(meter.read('gold')!.toString()).toBe(before);
  });
});
