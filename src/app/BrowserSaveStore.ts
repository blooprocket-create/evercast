import type { EngineConfig } from '../engine/config';
import type { GameState } from '../engine/model';
import { SaveCodec, type SaveEnvelopeV8 } from '../engine/save/SaveCodec';

export interface LoadedSave {
  state: GameState;
  savedAt: Date;
}

/** The slice of `Storage` this needs, so a test does not need a browser. */
export type SaveStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export class BrowserSaveStore {
  private readonly codec: SaveCodec;

  /**
   * `storage` is passed in rather than reached for. Touching `localStorage`
   * throws outright in a sandboxed iframe or on an opaque origin, and this is
   * constructed while the module graph is still evaluating - as a default
   * argument it would throw there before any `try` could catch it, which is the
   * blank page this whole class is trying not to be. `null` means no storage:
   * the game runs, it just does not persist.
   */
  constructor(
    config: EngineConfig,
    private readonly key: string,
    private readonly storage: SaveStorage | null,
  ) {
    this.codec = new SaveCodec(config);
  }

  load(): LoadedSave | null {
    try {
      const encoded = this.storage?.getItem(this.key) ?? null;
      if (!encoded) return null;
      return this.codec.decode(JSON.parse(encoded));
    } catch (error) {
      console.warn('Evercast save could not be loaded; starting fresh.', error);
      return null;
    }
  }

  /**
   * `savedAt` is what boot measures away time against, so a caller part-way
   * through a catch-up can backdate the stamp by whatever it still owes and have
   * the rest picked up next boot instead of lost.
   */
  save(state: GameState, savedAt = new Date()): void {
    const envelope: SaveEnvelopeV8 = this.codec.encode(state, savedAt);
    this.storage?.setItem(this.key, JSON.stringify(envelope));
  }

  /** The save as a file the player can keep, in the codec's own format. */
  exportSave(state: GameState, savedAt = new Date()): string {
    return JSON.stringify(this.codec.encode(state, savedAt), null, 2);
  }

  /**
   * Decodes first so a malformed or unsupported file is rejected before it can
   * overwrite anything, then writes it. Throws with the codec's own message.
   */
  importSave(json: string): LoadedSave {
    const loaded = this.codec.decode(JSON.parse(json));
    this.storage?.setItem(this.key, json);
    return loaded;
  }

  clear(): void {
    this.storage?.removeItem(this.key);
  }
}
