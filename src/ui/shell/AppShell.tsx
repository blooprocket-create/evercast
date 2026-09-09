import { useMemo, useState } from 'react';
import { accentForZone, accentVariable } from '../theme/biome';
import { HudOverlay, ShelfLog, ShelfVitals } from './HudOverlay';
import { WelcomeBack } from '../surfaces/WelcomeBack';
import { SurfaceHost } from './SurfaceHost';
import { Shelf } from '../nav/Shelf';
import {
  type Badge,
  badgeFor as badgeOf,
  groupDestinations,
  shelfLayout,
  visibleDestinations,
} from '../nav/destinations';
import { DEFAULT_PINNED, type RegisteredDestination, loadRegistry } from '../nav/registry';
import { useSnapshot, useSnapshotSelector } from '../state/snapshot';
import type { OfflineSummary } from '../../engine/offline/OfflineProgressor';
import styles from './AppShell.module.css';

interface AppShellProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  awayProgress: OfflineSummary | null;
  onDismissAwayProgress: () => void;
}

export function AppShell({ canvasRef, awayProgress, onDismissAwayProgress }: AppShellProps) {
  const registry = useMemo(() => loadRegistry(), []);
  const [activeId, setActiveId] = useState<string | null>(null);

  // The interface wears the accent of the zone the player is standing in.
  const zone = useSnapshotSelector((s) => s.zone);
  const accent = accentVariable(accentForZone(zone));

  return (
    <main className={styles.shell} style={{ '--accent': accent } as React.CSSProperties}>
      <canvas ref={canvasRef} className={styles.canvas} aria-label="Evercast game world" />
      <div className={styles.layer}>
        <HudOverlay />
        <ShelfContainer
          registry={registry}
          activeId={activeId}
          onOpen={(id) => setActiveId((current) => (current === id ? null : id))}
        />
        <ActiveSurface
          registry={registry}
          activeId={activeId}
          onSelect={setActiveId}
          onClose={() => setActiveId(null)}
        />
        {awayProgress && awayProgress.secondsApplied >= 5 && (
          <WelcomeBack summary={awayProgress} onDismiss={onDismissAwayProgress} />
        )}
      </div>
    </main>
  );
}

/**
 * Re-renders at the publish rate because it draws live vitals; the shelf's own
 * structure never changes, however many destinations exist.
 */
function ShelfContainer({
  registry,
  activeId,
  onOpen,
}: {
  registry: readonly RegisteredDestination[];
  activeId: string | null;
  onOpen: (id: string) => void;
}) {
  const snapshot = useSnapshot();
  const layout = shelfLayout(registry, snapshot, DEFAULT_PINNED);
  const firstOverflowId = layout.overflow[0]?.id ?? layout.pinned[0]?.id ?? null;

  return (
    <Shelf
      pinned={layout.pinned}
      overflowBadge={layout.overflowBadge}
      badgeFor={(destination) => badgeOf(destination, snapshot)}
      activeId={activeId}
      onOpen={onOpen}
      onOpenMore={() => firstOverflowId && onOpen(firstOverflowId)}
      vitals={<ShelfVitals />}
      log={<ShelfLog />}
    />
  );
}

function ActiveSurface({
  registry,
  activeId,
  onSelect,
  onClose,
}: {
  registry: readonly RegisteredDestination[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const snapshot = useSnapshot();
  if (activeId === null) return null;

  const visible = visibleDestinations(registry, snapshot) as RegisteredDestination[];
  const destination = visible.find((entry) => entry.id === activeId);
  if (!destination) return null;

  const badges = new Map<string, Badge | null>(
    visible.map((entry) => [entry.id, badgeOf(entry, snapshot)]),
  );

  return (
    <SurfaceHost
      destination={destination}
      groups={groupDestinations(visible)}
      badgeFor={(id) => badges.get(id) ?? null}
      onSelect={onSelect}
      onClose={onClose}
    />
  );
}
