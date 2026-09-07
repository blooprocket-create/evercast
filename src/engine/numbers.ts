import Decimal from 'break_eternity.js';

export type BigSource = Decimal | number | string;

export function big(value: BigSource = 0): Decimal {
  return new Decimal(value);
}

export function encodeBig(value: Decimal): string {
  return value.toString();
}

export function formatBig(value: Decimal, fractionDigits = 2): string {
  const numeric = value.toNumber();
  if (Number.isFinite(numeric)) {
    const absolute = Math.abs(numeric);
    if (absolute < 1_000_000) {
      return numeric.toLocaleString(undefined, {
        maximumFractionDigits: fractionDigits,
      });
    }
    return numeric.toExponential(fractionDigits);
  }
  return value.toString();
}

export interface QuantitySnapshot {
  raw: string;
  display: string;
}

export function quantity(value: Decimal): QuantitySnapshot {
  return {
    raw: encodeBig(value),
    display: formatBig(value),
  };
}
