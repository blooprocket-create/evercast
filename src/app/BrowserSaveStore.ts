import type { EngineConfig } from '../engine/config';
import type { GameState } from '../engine/model';
import { SaveCodec, type SaveEnvelopeV6 } from '../engine/save/SaveCodec';

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
    const envelope: SaveEnvelopeV6 = this.codec.encode(state);
    localStorage.setItem(this.key, JSON.stringify(envelope));
  }

  clear(): void {
    localStorage.removeItem(this.key);
  }
}
