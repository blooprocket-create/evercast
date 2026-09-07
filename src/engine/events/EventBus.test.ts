import { describe, expect, it } from 'vitest';
import { EventBus } from './EventBus';

describe('EventBus', () => {
  it('preserves deterministic ordering when listeners emit more events', () => {
    const bus = new EventBus<number>();
    const seen: number[] = [];
    bus.subscribe((value) => {
      seen.push(value);
      if (value === 1) bus.emit(2);
    });
    bus.emit(1);
    expect(seen).toEqual([1, 2]);
  });
});
