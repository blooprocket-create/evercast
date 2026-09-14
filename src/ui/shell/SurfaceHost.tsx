import { NumberCell } from '../format/NumberCell';
import { Icon } from '../icons/Icon';
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
  const WALLETS = [
    { id: 'gold', label: 'Gold', icon: 'gold', value: gold },
    { id: 'essence', label: 'Essence', icon: 'essence', value: essence },
    { id: 'starlight', label: 'Starlight', icon: 'starlight', value: starlight },
  ] as const;
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
            three numbers on screen.

            Below 560px there is no room for three words, and the answer used
            to be a 7px `::before` in the wallet's own colour - which left
            three numbers distinguishable by hue alone, with no text
            alternative either. That is WCAG 1.4.1 on the game's primary
            readout. A glyph is a shape as well as a colour, and the word goes
            with it: visible where it fits, and read out by a screen reader
            where it does not. See `.walletLabel` in SurfaceHost.module.css.
          */}
          {WALLETS.map(({ id, label, icon, value }) => (
            <span key={id} className={`${styles.walletItem} ${styles[id]}`}>
              <Icon name={icon} size={14} />
              <span className={styles.walletLabel}>{label}</span>
              <NumberCell value={value} inline />
            </span>
          ))}
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
