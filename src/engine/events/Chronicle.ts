import type { GameEvent } from './GameEvent';
import { describeGameEvent } from './describeGameEvent';
import { logWeight } from './logWeight';

/**
 * The event log, with a memory.
 *
 * What the snapshot carried before this was `lastEvent: string` - one line,
 * replaced by whatever happened next, and `display: none` below 860px, so on
 * every phone and every portrait tablet the game's only prose narration did
 * not exist. This is the same idea with a ring behind it: what the player
 * missed while a surface was open, while they were away, or while the line was
 * being overwritten four times a second.
 *
 * It is deliberately not saved. A chronicle is about this session; a save that
 * carried one would have to version it, migrate it, and grow forever.
 */
export interface ChronicleLine {
  /**
   * Monotonic across the session. It is the React key, and it is also how a
   * caller answers "what is new since I last looked" with a comparison rather
   * than by diffing text that legitimately repeats.
   */
  seq: number;
  /** Seconds into the run, so the scrollback can carry its own clock. */
  at: number;
  text: string;
}

/**
 * Deep enough to scroll back past a Rebirth, short enough that the array is
 * never worth windowing and an offline settle cannot grow it without bound.
 */
export const CHRONICLE_DEPTH = 120;

export class Chronicle {
  private lines: ChronicleLine[] = [];
  private seq = 0;
  /** The subject of the newest line, for the folding rule in `logWeight`. */
  private subject: string | undefined;
  /**
   * The array handed to the snapshot. Rebuilt only when a line is recorded, so
   * a consumer that compares by reference sees no change on the publishes -
   * the vast majority - where nothing was worth logging.
   */
  private published: readonly ChronicleLine[] = [];

  constructor(private readonly depth: number = CHRONICLE_DEPTH) {}

  record(event: GameEvent): void {
    const weight = logWeight(event);
    if (!weight.line) return;

    const line: ChronicleLine = {
      seq: (this.seq += 1),
      at: event.time,
      text: describeGameEvent(event),
    };

    if (weight.subject !== undefined && weight.subject === this.subject && this.lines.length > 0) {
      this.lines[this.lines.length - 1] = line;
    } else {
      this.lines.push(line);
      if (this.lines.length > this.depth) this.lines.splice(0, this.lines.length - this.depth);
    }

    this.subject = weight.subject;
    this.published = this.lines.slice();
  }

  /** Oldest first, which is the order it happened in. */
  read(): readonly ChronicleLine[] {
    return this.published;
  }
}
