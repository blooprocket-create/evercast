import Decimal from 'break_eternity.js';
import { big } from '../numbers';

/**
 * The primitives every field of a decoded save passes through.
 *
 * The save blob is the one input to this game that a player fully controls: it
 * is a file they can edit and a browser storage key they can type into. Before
 * this module the codec spread it straight into `GameState` - `{...run}`,
 * `{...meta}`, `{...enemy}` - which meant an edited file could introduce fields
 * the model never declared, and could hand a `Decimal` the strings `"NaN"` or
 * `"Infinity"`, both of which `break_eternity` accepts and neither of which any
 * later arithmetic recovers from. A wallet that reaches NaN stays NaN for the
 * life of the save.
 *
 * So nothing is trusted and nothing is spread. Every field is named, typed and
 * bounded on the way in, and anything that fails falls back to a value the
 * rules can express. The guarantee this buys is narrow and worth stating
 * exactly: no input can put the simulation into a state it could not have
 * reached by playing. It is not a guarantee that a determined player cannot
 * cheat their own single-player save - see `SaveIntegrity.ts` for why that is
 * not something a game with no server can promise.
 */

/** Longest string any save field may carry, so a blob cannot bloat the heap. */
export const MAX_SAVE_STRING = 120;

/** Longest array any save field may carry, for the same reason. */
export const MAX_SAVE_ARRAY = 512;

export function guardedBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export interface NumberBounds {
  min?: number;
  max?: number;
  integer?: boolean;
}

/**
 * A finite number inside its bounds, or the fallback.
 *
 * `Number.isFinite` is the whole point: `NaN` and `Infinity` both survive
 * `JSON.parse`, and a `NaN` cooldown means an enemy that never swings again
 * while an infinite one means a frame loop that never terminates.
 */
export function guardedNumber(value: unknown, fallback: number, bounds: NumberBounds = {}): number {
  const { min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, integer = false } = bounds;
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const clamped = Math.min(max, Math.max(min, value));
  return integer ? Math.floor(clamped) : clamped;
}

/** `guardedNumber` for the common case: a whole number that cannot go negative. */
export function guardedCount(value: unknown, fallback = 0, max = Number.MAX_SAFE_INTEGER): number {
  return guardedNumber(value, fallback, { min: 0, max, integer: true });
}

/**
 * A `Decimal` that later arithmetic can survive.
 *
 * `new Decimal('NaN')` and `new Decimal('Infinity')` both succeed, and every
 * `.add()` after them returns the same poison - which is how a single edited
 * character in a save file can permanently break an economy. break_eternity
 * stores a value as sign/layer/mag, so all three have to be finite for the
 * number to be one.
 *
 * Negative is rejected rather than clamped for the wallets that use this,
 * because nothing in the game can owe Essence; callers that legitimately allow
 * a negative pass `allowNegative`.
 */
export function guardedDecimal(
  value: unknown,
  fallback: Decimal | number = 0,
  { allowNegative = false }: { allowNegative?: boolean } = {},
): Decimal {
  const fallbackDecimal = fallback instanceof Decimal ? fallback : big(fallback);
  if (typeof value !== 'string' && typeof value !== 'number') return fallbackDecimal;
  // A string long enough to be a denial of service is not a number anyone reached.
  if (typeof value === 'string' && value.length > MAX_SAVE_STRING) return fallbackDecimal;

  let decoded: Decimal;
  try {
    decoded = big(value);
  } catch {
    return fallbackDecimal;
  }
  if (!isFiniteDecimal(decoded)) return fallbackDecimal;
  if (!allowNegative && decoded.sign < 0) return fallbackDecimal;
  return decoded;
}

/** Whether every component of a `Decimal` is a real number. */
export function isFiniteDecimal(value: Decimal): boolean {
  return Number.isFinite(value.sign) && Number.isFinite(value.layer) && Number.isFinite(value.mag);
}

/** A bounded string, or the fallback. Empty counts as absent. */
export function guardedString(value: unknown, fallback: string, max = MAX_SAVE_STRING): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) return fallback;
  return value;
}

/** One of a closed set of strings, or the fallback. */
export function guardedEnum<T extends string>(
  value: unknown,
  options: readonly T[],
  fallback: T,
): T {
  return typeof value === 'string' && (options as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * A bounded array, mapped through `map`, with anything `map` rejects dropped.
 *
 * The length cap is the reason this exists rather than a bare `.map()`: an
 * `enemies` array of a million entries is a save file that hangs the tab on
 * boot, and the honest answer to it is to keep the first few and carry on.
 */
export function guardedArray<T>(
  value: unknown,
  map: (entry: unknown, index: number) => T | null,
  max = MAX_SAVE_ARRAY,
): T[] {
  if (!Array.isArray(value)) return [];
  const kept: T[] = [];
  for (let index = 0; index < value.length && kept.length < max; index += 1) {
    const mapped = map(value[index], index);
    if (mapped !== null) kept.push(mapped);
  }
  return kept;
}

/** A bounded, de-duplicated list of strings drawn from a known set. */
export function guardedIdList(
  value: unknown,
  known: (id: string) => boolean,
  max = MAX_SAVE_ARRAY,
): string[] {
  const seen = new Set<string>();
  return guardedArray(
    value,
    (entry) => {
      if (typeof entry !== 'string' || seen.has(entry) || !known(entry)) return null;
      seen.add(entry);
      return entry;
    },
    max,
  );
}

/** A plain object, or an empty one. Arrays are not objects for this purpose. */
export function guardedObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Keys that must never survive a parse.
 *
 * `JSON.parse` defines `__proto__` as an ordinary own property rather than
 * invoking the setter, so it does not pollute anything by itself. What it does
 * do is ride along into every later `{...spread}`, `Object.assign` and
 * structured clone, where the behaviour is no longer guaranteed to be so
 * boring. Dropping the three of them at the parse boundary costs nothing and
 * means no code downstream has to be audited for it again.
 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * `JSON.parse` with those keys removed and a size limit.
 *
 * Every path that reads an Evercast save goes through here rather than through
 * `JSON.parse` directly: storage on boot, and a file the player imports.
 */
export function parseSaveJson(text: string, maxBytes = 4_000_000): unknown {
  if (typeof text !== 'string') throw new Error('Evercast save is not text.');
  if (text.length > maxBytes) throw new Error('Evercast save is too large to be a save file.');
  return JSON.parse(text, function reviver(key, value) {
    return FORBIDDEN_KEYS.has(key) ? undefined : value;
  });
}
