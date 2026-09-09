import Decimal from 'break_eternity.js';

export type BigSource = Decimal | number | string;

export function big(value: BigSource = 0): Decimal {
  return new Decimal(value);
}

export function encodeBig(value: Decimal): string {
  return value.toString();
}

/**
 * Every displayed number fits in this many characters, at every magnitude
 * break_eternity can represent. Layout reserves `10ch` and stops caring what
 * the value is. Enforced by the ladder in numbers.test.ts.
 */
export const MAX_DISPLAY_WIDTH = 10;

/** Pinned locale: the host locale changes both grouping and *width*. */
const GROUPED = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function trimFixed(value: number, places: number): string {
  const fixed = value.toFixed(places);
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
}

/** `m.mme<exp>`, shedding mantissa precision until it fits the budget. */
function scientific(mantissa: number, exponent: string, budget: number): string {
  for (let places = 2; places >= 0; places -= 1) {
    const candidate = `${trimFixed(mantissa, places)}e${exponent}`;
    if (candidate.length <= budget) return candidate;
  }
  return `e${exponent}`;
}

function formatMagnitude(value: Decimal, budget: number, depth = 0): string {
  if (value.lt(1000)) return trimFixed(value.toNumber(), 2);
  if (value.lt(1e6)) return GROUPED.format(Math.floor(value.toNumber()));

  // 10^exponent, where the exponent is still an ordinary number.
  if (value.layer <= 1) {
    const exponent = value.exponent;
    if (Number.isFinite(exponent) && Math.abs(exponent) < 1e6) {
      return scientific(value.mantissa, String(Math.floor(exponent)), budget);
    }
  }

  // Each recursion must strictly shrink the value, or we would not terminate.
  const shrink = (reduced: Decimal, prefix: string): string | null => {
    if (depth >= 4 || !Number.isFinite(reduced.mag) || !reduced.lt(value)) return null;
    return `${prefix}${formatMagnitude(reduced, budget - prefix.length, depth + 1)}`;
  };

  // Too tall for one exponent: strip two logs and recurse. `ee30` is 10^10^30.
  if (value.layer <= 3) {
    const doubled = shrink(value.log10().log10(), 'ee');
    if (doubled !== null) return doubled;
  }

  // Tetration range: rank by super-logarithm. `F308` is roughly 10^^308.
  return shrink(value.slog(), 'F') ?? '~';
}

export function formatBig(value: Decimal): string {
  // A truly infinite value means the simulation has broken, not that the
  // player got very far. Say so in one character rather than recursing.
  if (!Number.isFinite(value.mag) || !Number.isFinite(value.layer)) {
    return Number.isNaN(value.mag) ? '0' : '∞';
  }
  if (value.sign < 0) return `-${formatMagnitude(value.neg(), MAX_DISPLAY_WIDTH - 1)}`;
  return formatMagnitude(value, MAX_DISPLAY_WIDTH);
}

export interface QuantitySnapshot {
  raw: string;
  display: string;
}

/**
 * `display` is computed on first read and cached. The snapshot carries 28 of
 * these plus two per live enemy, and the UI reads only a handful — formatting
 * them all eagerly was thousands of wasted `Intl` passes per second.
 *
 * It stays an own enumerable property, so deep-equality over whole snapshots
 * (SaveCodec.test.ts, EvercastSimulation.test.ts) still compares the strings.
 */
export function quantity(value: Decimal): QuantitySnapshot {
  let display: string | undefined;
  return {
    raw: encodeBig(value),
    get display(): string {
      if (display === undefined) display = formatBig(value);
      return display;
    },
  };
}
