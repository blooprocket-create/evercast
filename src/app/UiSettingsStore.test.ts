import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_UI_SETTINGS,
  UI_SETTINGS_KEY,
  UiSettingsStore,
  sanitizeUiSettings,
} from './UiSettingsStore';

/** A Storage-shaped object, so none of this needs a browser. */
function fakeStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    read: (key: string) => data.get(key) ?? null,
  };
}

describe('sanitizeUiSettings', () => {
  it('falls back to defaults for anything missing', () => {
    expect(sanitizeUiSettings(null)).toEqual(DEFAULT_UI_SETTINGS);
    expect(sanitizeUiSettings({})).toEqual(DEFAULT_UI_SETTINGS);
    expect(sanitizeUiSettings('nonsense')).toEqual(DEFAULT_UI_SETTINGS);
  });

  it('keeps the values it understands and repairs the rest', () => {
    const settings = sanitizeUiSettings({
      audio: { master: 0.25, muted: true, effects: 'loud' },
      display: { vfxQuality: 'high', depthOfField: 2 },
    });
    expect(settings.audio.master).toBe(0.25);
    expect(settings.audio.muted).toBe(true);
    expect(settings.audio.effects).toBe(DEFAULT_UI_SETTINGS.audio.effects);
    expect(settings.display.vfxQuality).toBe('high');
    // Out of range rather than absent: clamped, not discarded.
    expect(settings.display.depthOfField).toBe(1);
  });

  it('rejects a quality level the renderer does not have', () => {
    expect(sanitizeUiSettings({ display: { vfxQuality: 'ultra' } }).display.vfxQuality).toBe(
      DEFAULT_UI_SETTINGS.display.vfxQuality,
    );
  });

  it('clamps volumes rather than trusting them', () => {
    const settings = sanitizeUiSettings({ audio: { master: -5, music: 99, effects: NaN } });
    expect(settings.audio.master).toBe(0);
    expect(settings.audio.music).toBe(1);
    expect(settings.audio.effects).toBe(DEFAULT_UI_SETTINGS.audio.effects);
  });
});

describe('UiSettingsStore', () => {
  it('starts from defaults with nothing stored', () => {
    expect(new UiSettingsStore(fakeStorage()).getSettings()).toEqual(DEFAULT_UI_SETTINGS);
  });

  it('reads back what it wrote', () => {
    const storage = fakeStorage();
    const store = new UiSettingsStore(storage);
    store.setDisplay({ depthOfField: 0.3, vfxQuality: 'low' });

    const reopened = new UiSettingsStore(storage);
    expect(reopened.getSettings().display.depthOfField).toBe(0.3);
    expect(reopened.getSettings().display.vfxQuality).toBe('low');
  });

  it('survives a corrupt blob instead of failing to boot', () => {
    const store = new UiSettingsStore(fakeStorage({ [UI_SETTINGS_KEY]: '{not json' }));
    expect(store.getSettings()).toEqual(DEFAULT_UI_SETTINGS);
  });

  it('works with no storage at all', () => {
    const store = new UiSettingsStore(null);
    expect(() => store.setAudio({ muted: true })).not.toThrow();
    expect(store.getSettings().audio.muted).toBe(true);
  });

  it('does not let a full quota take the app down', () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const store = new UiSettingsStore(storage);
    expect(() => store.setAudio({ master: 0.1 })).not.toThrow();
    expect(store.getSettings().audio.master).toBe(0.1);
  });

  it('tells subscribers when something changes', () => {
    const store = new UiSettingsStore(fakeStorage());
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.setAudio({ muted: true });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.setAudio({ muted: false });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('hands out a new object per change, so React sees it', () => {
    const store = new UiSettingsStore(fakeStorage());
    const before = store.getSettings();
    store.setDisplay({ damageNumbers: false });
    expect(store.getSettings()).not.toBe(before);
    expect(before.display.damageNumbers).toBe(true);
  });

  it('resets to defaults', () => {
    const store = new UiSettingsStore(fakeStorage());
    store.setDisplay({ depthOfField: 0 });
    store.reset();
    expect(store.getSettings()).toEqual(DEFAULT_UI_SETTINGS);
  });
});
