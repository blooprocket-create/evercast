import type { FrameRatePreference } from '../game/render/DeviceProfile';
import type { VfxQuality } from '../game/vfx/VfxPool';

/**
 * Player preferences, kept apart from the save.
 *
 * Deliberately its own localStorage key rather than a field on GameState: the
 * save codec is engine-owned and versioned, and it should not have to migrate
 * because someone changed a slider. It also means a corrupt preference blob can
 * never cost anyone their progress.
 */
export interface AudioSettings {
  master: number;
  music: number;
  effects: number;
  muted: boolean;
}

export interface DisplaySettings {
  /** 0 turns depth of field off; 1 is the shallowest focus. */
  depthOfField: number;
  /**
   * How many frames a second the renderer may draw.
   *
   * Kept apart from `vfxQuality` because it is the only display setting about
   * the device rather than the picture: nothing on screen changes, and on a
   * phone it is the difference between a session and a warm phone. `auto`
   * defers to what `DeviceProfile` made of the device.
   */
  frameRate: FrameRatePreference;
  vfxQuality: VfxQuality;
  damageNumbers: boolean;
  /** Go straight to what a summon pulled, skipping the reveal. */
  skipSummonAnimation: boolean;
}

export interface UiSettings {
  audio: AudioSettings;
  display: DisplaySettings;
}

export const DEFAULT_UI_SETTINGS: UiSettings = {
  audio: { master: 0.8, music: 0.7, effects: 0.85, muted: false },
  display: {
    depthOfField: 0.75,
    frameRate: 'auto',
    vfxQuality: 'medium',
    damageNumbers: true,
    skipSummonAnimation: false,
  },
};

export const UI_SETTINGS_KEY = 'evercast.ui.v1';

const VFX_QUALITIES: readonly VfxQuality[] = ['low', 'medium', 'high'];
const FRAME_RATES: readonly FrameRatePreference[] = ['auto', 'battery', 'smooth', 'unlimited'];

const clamp01 = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;

const boolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

/**
 * Everything read back is treated as untrusted: a hand-edited or half-written
 * blob should degrade to defaults, never render a broken control.
 */
export function sanitizeUiSettings(raw: unknown): UiSettings {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const audio = (source.audio ?? {}) as Record<string, unknown>;
  const display = (source.display ?? {}) as Record<string, unknown>;
  const quality = display.vfxQuality;

  return {
    audio: {
      master: clamp01(audio.master, DEFAULT_UI_SETTINGS.audio.master),
      music: clamp01(audio.music, DEFAULT_UI_SETTINGS.audio.music),
      effects: clamp01(audio.effects, DEFAULT_UI_SETTINGS.audio.effects),
      muted: boolean(audio.muted, DEFAULT_UI_SETTINGS.audio.muted),
    },
    display: {
      depthOfField: clamp01(display.depthOfField, DEFAULT_UI_SETTINGS.display.depthOfField),
      frameRate: FRAME_RATES.includes(display.frameRate as FrameRatePreference)
        ? (display.frameRate as FrameRatePreference)
        : DEFAULT_UI_SETTINGS.display.frameRate,
      vfxQuality: VFX_QUALITIES.includes(quality as VfxQuality)
        ? (quality as VfxQuality)
        : DEFAULT_UI_SETTINGS.display.vfxQuality,
      damageNumbers: boolean(display.damageNumbers, DEFAULT_UI_SETTINGS.display.damageNumbers),
      skipSummonAnimation: boolean(
        display.skipSummonAnimation,
        DEFAULT_UI_SETTINGS.display.skipSummonAnimation,
      ),
    },
  };
}

type Listener = () => void;

export class UiSettingsStore {
  private current: UiSettings;
  private readonly listeners = new Set<Listener>();

  /** `storage` is injected so the store is testable without a browser. */
  constructor(
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null,
    private readonly key = UI_SETTINGS_KEY,
  ) {
    this.current = sanitizeUiSettings(this.read());
  }

  private read(): unknown {
    try {
      const raw = this.storage?.getItem(this.key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      // A corrupt blob is not worth a crash on boot.
      return null;
    }
  }

  readonly getSettings = (): UiSettings => this.current;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  setAudio(patch: Partial<AudioSettings>): void {
    this.commit({ ...this.current, audio: { ...this.current.audio, ...patch } });
  }

  setDisplay(patch: Partial<DisplaySettings>): void {
    this.commit({ ...this.current, display: { ...this.current.display, ...patch } });
  }

  reset(): void {
    this.commit(sanitizeUiSettings(null));
  }

  private commit(next: UiSettings): void {
    this.current = sanitizeUiSettings(next);
    try {
      this.storage?.setItem(this.key, JSON.stringify(this.current));
    } catch {
      // Private browsing and full quotas are not errors the player can act on.
    }
    for (const listener of this.listeners) listener();
  }
}
