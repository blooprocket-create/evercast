import type { EngineConfig } from '../engine/config';
import type { GameState } from '../engine/model';
import { SaveCodec, type SaveEnvelopeV7 } from '../engine/save/SaveCodec';

export interface LoadedSave {
  state: GameState;
  savedAt: Date;
}

export class BrowserSaveStore {
  private readonly codec: SaveCodec;

  constructor(
    config: EngineConfig,
    private readonly key = 'evercast.save.v1',
  ) {
    this.codec = new SaveCodec(config);
  }

  load(): LoadedSave | null {
    try {
      const encoded = localStorage.getItem(this.key);
      if (!encoded) return null;
      return this.codec.decode(JSON.parse(encoded));
    } catch (error) {
      console.warn('Evercast save could not be loaded; starting fresh.', error);
      return null;
    }
  }

  save(state: GameState): void {
    const envelope: SaveEnvelopeV7 = this.codec.encode(state);
    localStorage.setItem(this.key, JSON.stringify(envelope));
  }

  /** The save as a file the player can keep, in the codec's own format. */
  exportSave(state: GameState): string {
    return JSON.stringify(this.codec.encode(state), null, 2);
  }

  /**
   * Decodes first so a malformed or unsupported file is rejected before it can
   * overwrite anything, then writes it. Throws with the codec's own message.
   */
  importSave(json: string): LoadedSave {
    const loaded = this.codec.decode(JSON.parse(json));
    localStorage.setItem(this.key, json);
    return loaded;
  }

  clear(): void {
    localStorage.removeItem(this.key);
  }
}
