import type { Badge as BadgeValue } from '../nav/destinations';
import styles from './Badge.module.css';

interface BadgeProps {
  value: BadgeValue;
  urgent?: boolean;
}

export function Badge({ value, urgent }: BadgeProps) {
  const classes = [styles.badge];
  if (value === 'dot') classes.push(styles.dot);
  if (urgent) classes.push(styles.urgent);
  return (
    <span className={classes.join(' ')} aria-hidden={value === 'dot'}>
      {value === 'dot' ? '' : value}
    </span>
  );
}
