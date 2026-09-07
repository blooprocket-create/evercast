import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE_CONFIG } from '../config';
import { EvercastSimulation } from '../EvercastSimulation';
import { SaveCodec } from './SaveCodec';

describe('SaveCodec', () => {
  it('round-trips authoritative state including large-number fields', () => {
    const sim = new EvercastSimulation();
    sim.advance(90, { presentationEvents: false });
    const codec = new SaveCodec(DEFAULT_ENGINE_CONFIG);
    const encoded = codec.encode(sim.getState(), new Date('2026-01-01T00:00:00Z'));
    const decoded = codec.decode(JSON.parse(JSON.stringify(encoded)));
    const restored = new EvercastSimulation({ initialState: decoded.state });
    expect(restored.getSnapshot()).toEqual(sim.getSnapshot());
    expect(decoded.savedAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});
