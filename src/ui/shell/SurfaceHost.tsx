import { NumberCell } from '../format/NumberCell';
import { NavRail } from '../nav/NavRail';
import { Button } from '../primitives/Button';
import type { Badge, GroupedDestinations } from '../nav/destinations';
import type { RegisteredDestination } from '../nav/registry';
import { useSnapshotSelector } from '../state/snapshot';
import styles from './SurfaceHost.module.css';

interface SurfaceHostProps {
  destination: RegisteredDestination;
  groups: readonly GroupedDestinations[];
  badgeFor: (id: string) => Badge | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function SurfaceHost({
  destination,
  groups,
  badgeFor,
  onSelect,
  onClose,
}: SurfaceHostProps) {
  const gold = useSnapshotSelector((s) => s.gold.display);
  const essence = useSnapshotSelector((s) => s.essence.display);
  const Surface = destination.Component;

  return (
    <section className={styles.host} aria-label={destination.label}>
      <header className={styles.header}>
        <Button variant="quiet" onClick={onClose}>
          Back
        </Button>
        <h2 className={styles.title}>{destination.label}</h2>
        <span className={styles.spacer} />
        <div className={styles.wallets}>
          <span className={styles.walletItem}>
            <span className={styles.gold}>
              <NumberCell value={gold} />
            </span>
          </span>
          <span className={styles.walletItem}>
            <span className={styles.essence}>
              <NumberCell value={essence} />
            </span>
          </span>
        </div>
      </header>

      <div className={styles.body}>
        <NavRail
          groups={groups}
          activeId={destination.id}
          badgeFor={badgeFor}
          onSelect={onSelect}
        />
        <div className={styles.surface}>
          <Surface />
        </div>
      </div>
    </section>
  );
}
