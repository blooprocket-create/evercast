import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE_CONFIG } from '../config';
import { EvercastSimulation } from '../EvercastSimulation';
import type { SimulationSnapshot } from '../types';
// prettier-ignore
import { CURRENT_SAVE_VERSION, MINIMUM_SAVE_VERSION, SaveCodec } from './SaveCodec';

function authoritativeSnapshot(snapshot: SimulationSnapshot) {
  const { lastEvent: _ephemeralPresentationText, ...authoritative } = snapshot;
  return authoritative;
}

describe('SaveCodec', () => {
  it('round-trips authoritative state including large-number fields', () => {
    const sim = new EvercastSimulation();
    sim.advance(90, { presentationEvents: false });
    const codec = new SaveCodec(DEFAULT_ENGINE_CONFIG);
    const encoded = codec.encode(sim.getState(), new Date('2026-01-01T00:00:00Z'));
    const decoded = codec.decode(JSON.parse(JSON.stringify(encoded)));
    const restored = new EvercastSimulation({ initialState: decoded.state });
    expect(authoritativeSnapshot(restored.getSnapshot())).toEqual(authoritativeSnapshot(sim.getSnapshot()));
    expect(decoded.savedAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  /**
   * The v1-v4 migrations were dropped once the format settled, so the window is
   * now a stated boundary rather than a side effect of which branches survived.
   * A save outside it is refused here and reported by `BrowserSaveStore.load`,
   * which starts the player fresh rather than loading a state this codec can no
   * longer describe.
   */
  describe('the versions it accepts', () => {
    const codec = new SaveCodec(DEFAULT_ENGINE_CONFIG);

    it('refuses saves older than the floor', () => {
      for (let version = 1; version < MINIMUM_SAVE_VERSION; version += 1) {
        expect(() => codec.decode({ version, state: {} })).toThrow(
          /Unsupported Evercast save version/,
        );
      }
    });

    it('refuses a version from the future', () => {
      expect(() => codec.decode({ version: CURRENT_SAVE_VERSION + 1, state: {} })).toThrow(
        /Unsupported Evercast save version/,
      );
    });

    it('still brings forward every version inside the window', () => {
      const sim = new EvercastSimulation();
      sim.advance(300, { presentationEvents: false });
      const current = codec.encode(sim.getState());

      for (let version = MINIMUM_SAVE_VERSION; version <= CURRENT_SAVE_VERSION; version += 1) {
        const envelope = { ...structuredClone(current), version };
        const loaded = codec.decode(envelope);
        expect(loaded.state.meta.highestStageEver, `v${version}`).toBe(
          sim.getState().meta.highestStageEver,
        );
        // Companions arrive with v7; older saves load with the feature not started.
        const party = loaded.state.companions.party.filter(Boolean).length;
        expect(party, `v${version}`).toBe(version >= 7 ? party : 0);
        // Attunements arrive with v8; older saves load on the original rules.
        expect(loaded.state.spellTree.attunements, `v${version}`).toEqual([]);
      }
    });
  });
});
