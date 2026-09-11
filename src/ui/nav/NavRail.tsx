import { Badge } from '../primitives/Badge';
import { Icon } from '../icons/Icon';
import { type Badge as BadgeValue, type GroupedDestinations } from './destinations';
import styles from './NavRail.module.css';

const GROUP_LABELS: Record<string, string> = {
  power: 'Power',
  companion: 'Companions',
  world: 'World',
  record: 'Record',
};

/**
 * Renders whatever the registry contains, grouped and scrollable on one axis.
 * Three destinations or fourteen, this component does not change.
 */
interface NavRailProps {
  groups: readonly GroupedDestinations[];
  activeId: string | null;
  badgeFor: (id: string) => BadgeValue | null;
  onSelect: (id: string) => void;
}

export function NavRail({ groups, activeId, badgeFor, onSelect }: NavRailProps) {
  return (
    <nav className={styles.rail} aria-label="Destinations">
      {groups.map((section) => (
        <div key={section.group}>
          <div className={styles.group}>{GROUP_LABELS[section.group] ?? section.group}</div>
          {section.entries.map((destination) => {
            const badge = badgeFor(destination.id);
            return (
              <button
                key={destination.id}
                type="button"
                className={
                  activeId === destination.id ? `${styles.entry} ${styles.current}` : styles.entry
                }
                aria-current={activeId === destination.id ? 'page' : undefined}
                onClick={() => onSelect(destination.id)}
              >
                <Icon name={destination.icon} size={16} />
                <span className={styles.label}>{destination.label}</span>
                {badge !== null && <Badge value={badge} />}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
