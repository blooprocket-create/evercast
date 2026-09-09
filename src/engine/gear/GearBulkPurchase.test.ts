import { describe, expect, it } from 'vitest';
import { big } from '../numbers';
import { GEAR_BULK_LIMIT, gearBulkPurchase, gearLevelCost } from './GearSystem';

/**
 * The interface used to show the next level's price with "each" beside it,
 * which was wrong: the curve rises every level, so ten levels never cost ten
 * times the first. These assertions are the reason it cannot drift back.
 */
const RICH = big('1e12');

describe('gearBulkPurchase', () => {
  it('sums the rising curve rather than multiplying the next price', () => {
    const { levels, total } = gearBulkPurchase('staff', 10, 10, RICH);
    expect(levels).toBe(10);

    let expected = big(0);
    for (let level = 10; level < 20; level += 1) expected = expected.add(gearLevelCost('staff', level));
    expect(total.toString()).toBe(expected.toString());

    // ...and that total is strictly more than ten times the first level.
    expect(total.cmp(gearLevelCost('staff', 10).mul(10))).toBeGreaterThan(0);
  });

  it('buys only what the gold covers', () => {
    const first = gearLevelCost('staff', 10);
    const second = gearLevelCost('staff', 11);
    const budget = first.add(second);

    const exact = gearBulkPurchase('staff', 10, 10, budget);
    expect(exact.levels).toBe(2);
    expect(exact.total.toString()).toBe(budget.toString());

    const short = gearBulkPurchase('staff', 10, 10, budget.sub(1));
    expect(short.levels).toBe(1);
    expect(short.total.toString()).toBe(first.toString());
  });

  it('reports nothing when even one level is out of reach', () => {
    const { levels, total } = gearBulkPurchase('staff', 10, 10, big(0));
    expect(levels).toBe(0);
    expect(total.toString()).toBe('0');
  });

  it('never charges for more levels than asked', () => {
    expect(gearBulkPurchase('staff', 1, 1, RICH).levels).toBe(1);
    expect(gearBulkPurchase('staff', 1, 3, RICH).levels).toBe(3);
  });

  it('terminates on Max even with effectively unbounded gold', () => {
    const { levels } = gearBulkPurchase('staff', 1, GEAR_BULK_LIMIT, big('1e300'));
    expect(levels).toBe(GEAR_BULK_LIMIT);
  });

  it('agrees with the engine on what one level costs', () => {
    // The single-level path is what level_gear itself charges.
    const one = gearBulkPurchase('helm', 42, 1, RICH);
    expect(one.total.toString()).toBe(gearLevelCost('helm', 42).toString());
  });
});
