import { Badge } from '../primitives/Badge';
import { Icon } from '../icons/Icon';
import type { Badge as BadgeValue, Destination } from './destinations';
import styles from './Shelf.module.css';

/**
 * Three pinned destinations and one More, forever. The shelf is a fixed cost
 * however large the registry becomes; growth goes to the rail behind More.
 *
 * Pure and prop-driven so it can be asserted without a DOM.
 */
interface ShelfProps {
  pinned: readonly Destination[];
  overflowBadge: BadgeValue | null;
  badgeFor: (destination: Destination) => BadgeValue | null;
  activeId: string | null;
  onOpen: (id: string) => void;
  onOpenMore: () => void;
  vitals?: React.ReactNode;
  log?: React.ReactNode;
}

export function Shelf({
  pinned,
  overflowBadge,
  badgeFor,
  activeId,
  onOpen,
  onOpenMore,
  vitals,
  log,
}: ShelfProps) {
  return (
    <nav className={styles.shelf} aria-label="Game menu">
      {vitals && <div className={styles.vitals}>{vitals}</div>}
      <span className={styles.divider} />

      <div className={styles.slots}>
        {pinned.map((destination) => {
          const badge = badgeFor(destination);
          return (
            <button
              key={destination.id}
              type="button"
              className={
                activeId === destination.id ? `${styles.slot} ${styles.active}` : styles.slot
              }
              aria-current={activeId === destination.id ? 'page' : undefined}
              onClick={() => onOpen(destination.id)}
            >
              <Icon name={destination.icon} size={21} />
              {destination.label}
              {badge !== null && (
                <span className={styles.badge}>
                  <Badge value={badge} />
                </span>
              )}
            </button>
          );
        })}

        <button
          type="button"
          className={`${styles.slot} ${styles.more}`}
          onClick={onOpenMore}
          aria-label="More destinations"
        >
          <Icon name="more" size={21} />
          More
          {overflowBadge !== null && (
            <span className={styles.badge}>
              <Badge value={overflowBadge} urgent />
            </span>
          )}
        </button>
      </div>

      <span className={styles.divider} />
      {log && <div className={styles.log}>{log}</div>}
    </nav>
  );
}
