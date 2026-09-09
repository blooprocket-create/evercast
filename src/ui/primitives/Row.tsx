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
}: RowProps) {
  const classes = [styles.row];
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
      <span className={iconLive ? `${styles.icon} ${styles.iconLive}` : styles.icon}>
        <Icon name={icon} size={17} />
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
