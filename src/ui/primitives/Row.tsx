import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/names';
import styles from './Row.module.css';

/**
 * The ledger row: icon, label, value, optional action. Fixed height by
 * contract. Every list in the game is made of these.
 */
interface RowProps {
  icon: IconName;
  iconLive?: boolean;
  label: string;
  sub?: string;
  value?: React.ReactNode;
  action?: React.ReactNode;
  selected?: boolean;
  onSelect?: () => void;
  /**
   * Lets the row wear a colour its owner sets, as `--row-tone` on any ancestor.
   *
   * The roster needed it: thirty companions across five rarities drew as
   * thirty identical grey rows, with the tier stated only as a word in the
   * 10px sub-label. Nothing is named here - the owner supplies the token, and
   * a row without one is unchanged.
   */
  toned?: boolean;
}

export function Row({
  icon,
  iconLive,
  label,
  sub,
  value,
  action,
  selected,
  onSelect,
  toned,
}: RowProps) {
  const classes = [styles.row];
  if (toned) classes.push(styles.toned);
  if (selected) classes.push(styles.selected);
  if (!onSelect) classes.push(styles.static);

  return (
    <button
      type="button"
      className={classes.join(' ')}
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      disabled={!onSelect}
    >
      <span
        className={[styles.icon, toned && styles.iconToned, iconLive && styles.iconLive]
          .filter(Boolean)
          .join(' ')}
      >
        <Icon name={icon} size={toned ? 20 : 17} />
      </span>
      <span className={styles.text}>
        <span className={styles.label}>{label}</span>
        {sub !== undefined && <span className={styles.sub}>{sub}</span>}
      </span>
      {value !== undefined && <span className={styles.value}>{value}</span>}
      {action !== undefined && <span className={styles.action}>{action}</span>}
    </button>
  );
}
