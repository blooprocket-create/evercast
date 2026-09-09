import type { QuantitySnapshot } from '../../engine/numbers';
import styles from './NumberCell.module.css';

/**
 * Every number in the interface renders through here. It reserves a fixed
 * character budget and uses tabular figures, so a column of values stays
 * aligned and nothing reflows when the player crosses a magnitude.
 *
 * The engine caps the display string at ten characters; the full-precision
 * value goes in the tooltip.
 */
interface NumberCellProps {
  value: QuantitySnapshot | string;
  /** Drop the reserved width when the number sits inside a sentence. */
  inline?: boolean;
  prefix?: string;
  suffix?: string;
  title?: string;
}

export function NumberCell({ value, inline, prefix, suffix, title }: NumberCellProps) {
  const display = typeof value === 'string' ? value : value.display;
  const precise = typeof value === 'string' ? undefined : value.raw;
  return (
    <span
      className={inline ? `${styles.cell} ${styles.inline}` : styles.cell}
      title={title ?? precise}
    >
      {prefix}
      {display}
      {suffix}
    </span>
  );
}
