import type { EngineConfig } from '../engine/config';
import type { GameState } from '../engine/model';
import { SaveCodec, type SaveEnvelope } from '../engine/save/SaveCodec';
import { parseSaveJson } from '../engine/save/SaveGuards';
import type { IntegrityVerdict } from '../engine/save/SaveIntegrity';

export interface LoadedSave {
  state: GameState;
  savedAt: Date;
  /**
   * What the save's own digest said about it. `mismatch` means the blob
   * changed after Evercast wrote it - an edit, or a half-written `setItem`.
   * The state is still loaded: it has been through the codec's validation
   * either way, and refusing it would cost a player their run for a corruption
   * they did not cause.
   */
  integrity: IntegrityVerdict;
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
      const loaded = this.codec.decode(parseSaveJson(encoded));
      if (loaded.integrity === 'mismatch') {
        console.warn(
          'Evercast save does not match its own checksum; it was edited or partly written. Loading it anyway, validated.',
        );
      }
      return loaded;
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
    const envelope: SaveEnvelope = this.codec.encode(state, savedAt);
    this.storage?.setItem(this.key, JSON.stringify(envelope));
  }

  /** The save as a file the player can keep, in the codec's own format. */
  exportSave(state: GameState, savedAt = new Date()): string {
    return JSON.stringify(this.codec.encode(state, savedAt), null, 2);
  }

  /**
   * Decodes first so a malformed or unsupported file is rejected before it can
   * overwrite anything, then writes it. Throws with the codec's own message.
   *
   * A file whose digest does not match is refused here, where `load` would have
   * accepted it. The difference is what a refusal costs: this is someone
   * choosing a file, with their existing run still intact and another file to
   * choose, so saying "this one has been changed" is information they can act
   * on. On boot there is no alternative to offer and the run is already theirs.
   *
   * This is a guard against a file that got mangled in transit or edited by
   * hand, and it is worth being straight about the limit: anyone who can edit a
   * save can also recompute its digest, because the algorithm ships with the
   * game. What stops an impossible state getting in is the codec's validation,
   * not this.
   */
  importSave(json: string): LoadedSave {
    const loaded = this.codec.decode(parseSaveJson(json));
    if (loaded.integrity === 'mismatch') {
      throw new Error(
        'That save file does not match its own checksum - it has been edited or damaged since Evercast wrote it.',
      );
    }
    this.storage?.setItem(this.key, json);
    return loaded;
  }

  clear(): void {
    this.storage?.removeItem(this.key);
  }
}
