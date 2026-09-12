import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE_CONFIG } from '../engine/config';
import { EvercastSimulation } from '../engine/EvercastSimulation';
import { CURRENT_SAVE_VERSION } from '../engine/save/SaveCodec';
import { BrowserSaveStore, type SaveStorage } from './BrowserSaveStore';

/** A Storage-shaped object, so none of this needs a browser. */
function fakeStorage(seed: Record<string, string> = {}): SaveStorage & { peek(key: string): string | null } {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
    peek: (key) => data.get(key) ?? null,
  };
}

const KEY = 'evercast.save.v1';
const store = (storage: SaveStorage | null) =>
  new BrowserSaveStore(DEFAULT_ENGINE_CONFIG, KEY, storage);

function playedState() {
  const simulation = new EvercastSimulation();
  simulation.advance(120, { presentationEvents: false });
  return simulation.getState();
}

describe('BrowserSaveStore', () => {
  it('round-trips a save', () => {
    const storage = fakeStorage();
    const state = playedState();
    store(storage).save(state);

    const loaded = store(storage).load();
    expect(loaded).not.toBeNull();
    expect(loaded?.state.meta.highestStageEver).toBe(state.meta.highestStageEver);
    expect(loaded?.state.run.stats.kills).toBe(state.run.stats.kills);
  });

  /**
   * Away time is measured from the stamp, so backdating it is how a session that
   * is part-way through a catch-up hands the remainder to the next boot instead
   * of banking a partial day as if it were the whole one.
   */
  it('carries outstanding away time forward through the stamp', () => {
    const storage = fakeStorage();
    const outstandingSeconds = 4 * 3600;
    const savedAt = new Date(Date.now() - outstandingSeconds * 1000);

    store(storage).save(playedState(), savedAt);
    const loaded = store(storage).load();

    const owedOnNextBoot = (Date.now() - (loaded?.savedAt.getTime() ?? 0)) / 1000;
    expect(owedOnNextBoot).toBeGreaterThanOrEqual(outstandingSeconds);
    expect(owedOnNextBoot).toBeLessThan(outstandingSeconds + 60);
  });

  it('stamps the moment of the save when nothing is owed', () => {
    const storage = fakeStorage();
    store(storage).save(playedState());
    const owed = (Date.now() - (store(storage).load()?.savedAt.getTime() ?? 0)) / 1000;
    expect(owed).toBeLessThan(60);
  });

  /**
   * `load` is called while the module graph is still being evaluated, before the
   * first render. Anything it throws is a blank page rather than a handled error,
   * so every unreadable blob has to come back as "no save" instead.
   */
  describe('never throws on the way up', () => {
    const unreadable: Record<string, string> = {
      'not json': '{{{',
      'not an object': '42',
      'no version': JSON.stringify({ state: {} }),
      'version from the future': JSON.stringify({ version: CURRENT_SAVE_VERSION + 1, state: {} }),
      'version that is not a number': JSON.stringify({ version: 'seven', state: {} }),
      'truncated state': JSON.stringify({ version: CURRENT_SAVE_VERSION, state: { run: {} } }),
    };

    for (const [what, blob] of Object.entries(unreadable)) {
      it(`degrades to a fresh start: ${what}`, () => {
        const storage = fakeStorage({ [KEY]: blob });
        expect(() => store(storage).load()).not.toThrow();

        // Either no save at all, or one carrying no progression - never a
        // half-built state, and never an exception.
        const loaded = store(storage).load();
        if (loaded) {
          expect(loaded.state.meta.highestStageEver).toBeLessThanOrEqual(1);
          expect(loaded.state.run.stats.kills).toBe(0);
        }
      });
    }

    it('reports no save rather than an empty one when storage is empty', () => {
      expect(store(fakeStorage()).load()).toBeNull();
    });
  });

  /**
   * Reaching for `localStorage` throws outright in a sandboxed iframe or on an
   * opaque origin, so the store is handed its storage and accepts not having any.
   * It is constructed while the module graph is evaluating: a throw here is a
   * blank page on every reload, which is the failure this class exists to avoid.
   */
  describe('without storage', () => {
    it('constructs, loads and saves without reaching for a global', () => {
      expect(() => store(null)).not.toThrow();
      expect(store(null).load()).toBeNull();
      expect(() => store(null).save(playedState())).not.toThrow();
      expect(() => store(null).clear()).not.toThrow();
    });

    it('still hands back an export the player can keep', () => {
      const exported = store(null).exportSave(playedState());
      expect(JSON.parse(exported).version).toBe(CURRENT_SAVE_VERSION);
    });
  });

  it('stamps an export with the time it is given, so owed time rides along', () => {
    const owedSeconds = 3 * 3600;
    const exported = store(fakeStorage()).exportSave(
      playedState(),
      new Date(Date.now() - owedSeconds * 1000),
    );
    const owedOnImport = (Date.now() - new Date(JSON.parse(exported).savedAt).getTime()) / 1000;
    expect(owedOnImport).toBeGreaterThanOrEqual(owedSeconds);
    expect(owedOnImport).toBeLessThan(owedSeconds + 60);
  });

  it('rejects an unsupported import before it can overwrite anything', () => {
    const storage = fakeStorage();
    store(storage).save(playedState());
    const before = storage.peek(KEY);

    expect(() =>
      store(storage).importSave(JSON.stringify({ version: CURRENT_SAVE_VERSION + 1, state: {} })),
    ).toThrow();
    expect(storage.peek(KEY)).toBe(before);
  });

  /**
   * The two ends of the digest, which deliberately disagree.
   *
   * Importing is someone choosing a file while their own run is still intact,
   * so "this one has been changed" is information they can act on. Booting has
   * no alternative to offer: refusing there would cost a player their run over
   * a `setItem` the browser was killed half-way through, and would stop no
   * cheating, because anyone who can edit a save can recompute its digest.
   */
  describe('the integrity digest', () => {
    const edited = () => {
      const exported = JSON.parse(store(null).exportSave(playedState()));
      exported.state.equipment.gold = '999999999999';
      return JSON.stringify(exported);
    };

    it('refuses an edited file on import, leaving the existing run alone', () => {
      const storage = fakeStorage();
      store(storage).save(playedState());
      const before = storage.peek(KEY);

      expect(() => store(storage).importSave(edited())).toThrow(/checksum/);
      expect(storage.peek(KEY)).toBe(before);
    });

    it('accepts an untouched export on import', () => {
      const storage = fakeStorage();
      const exported = store(null).exportSave(playedState());
      expect(() => store(storage).importSave(exported)).not.toThrow();
      expect(store(storage).load()?.integrity).toBe('ok');
    });

    it('still loads an edited save on boot, and says so', () => {
      const storage = fakeStorage({ [KEY]: edited() });
      const loaded = store(storage).load();
      expect(loaded).not.toBeNull();
      expect(loaded?.integrity).toBe('mismatch');
    });
  });
});
