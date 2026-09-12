import { NumberCell } from '../format/NumberCell';
import { NavRail } from '../nav/NavRail';
import { Button } from '../primitives/Button';
import type { Badge, GroupedDestinations } from '../nav/destinations';
import type { RegisteredDestination } from '../nav/registry';
import { useSnapshotSelector } from '../state/snapshot';
import { useEscape } from './useEscape';
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
  const starlight = useSnapshotSelector((s) => s.starlight.display);
  const Surface = destination.Component;
  // Back is the only way out of a surface, and it was mouse-only. Every other
  // overlay in the game closes on Escape; this is the one the player is in most
  // of the time.
  useEscape(onClose);

  return (
    <section className={styles.host} aria-label={destination.label}>
      <header className={styles.header}>
        <Button variant="quiet" onClick={onClose}>
          Back
        </Button>
        <h2 className={styles.title}>{destination.label}</h2>
        <span className={styles.spacer} />
        <div className={styles.wallets}>
          {/*
            The header covers the HUD, so it carries the only naming of these
            three numbers on screen. Below 360px the labels give way to a
            coloured dot - see SurfaceHost.module.css.
          */}
          <span className={`${styles.walletItem} ${styles.gold}`}>
            <span className={styles.walletLabel}>Gold</span>
            <NumberCell value={gold} inline />
          </span>
          <span className={`${styles.walletItem} ${styles.essence}`}>
            <span className={styles.walletLabel}>Essence</span>
            <NumberCell value={essence} inline />
          </span>
          <span className={`${styles.walletItem} ${styles.starlight}`}>
            <span className={styles.walletLabel}>Starlight</span>
            <NumberCell value={starlight} inline />
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
