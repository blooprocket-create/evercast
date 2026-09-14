import { useEffect, useRef } from 'react';
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
  const current = useRef<HTMLButtonElement>(null);

  /*
   * Below 860px the rail is a horizontally scrolling strip, and it never
   * scrolled. Opening Settings - last in the registry - from the shelf's More
   * left a 390px phone showing Character, Spell Tree, Gear, Attunements and no
   * highlighted entry at all: the current one was off the right edge, with
   * nothing on screen saying the strip moves. `nearest` on both axes so this
   * is the smallest correction that makes the entry visible, and so it is a
   * no-op on the wide layout where the column already shows everything.
   */
  useEffect(() => {
    current.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId]);

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
                ref={activeId === destination.id ? current : undefined}
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
