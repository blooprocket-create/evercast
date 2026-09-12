import { useMemo, useState } from 'react';
import type { BootPhase } from '../../app/BootPhase';
import { accentForZone, accentVariable } from '../theme/biome';
import { BootGate } from './BootGate';
import { CoachMark } from '../onboarding/CoachMark';
import { HudOverlay, ShelfLog, ShelfVitals } from './HudOverlay';
import { PREMISE_FLAG } from '../onboarding/flags';
import { Premise } from '../surfaces/Premise';
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
import { useCommand } from '../state/CommandContext';
import { useSnapshot, useSnapshotSelector } from '../state/snapshot';
import type { OfflineSummary } from '../../engine/offline/OfflineProgressor';
import styles from './AppShell.module.css';

interface AppShellProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  bootPhase: BootPhase;
  resumedFromSave: boolean;
  onBegin: () => void;
  awayProgress: OfflineSummary | null;
  onDismissAwayProgress: () => void;
}

export function AppShell({
  canvasRef,
  bootPhase,
  resumedFromSave,
  onBegin,
  awayProgress,
  onDismissAwayProgress,
}: AppShellProps) {
  const registry = useMemo(() => loadRegistry(), []);
  const [activeId, setActiveId] = useState<string | null>(null);

  // The interface wears the accent of the zone the player is standing in.
  const zone = useSnapshotSelector((s) => s.zone);
  const accent = accentVariable(accentForZone(zone));
  const playing = bootPhase === 'playing';
  // The threshold is the away report's own, not a second guess at it: a moment
  // that is not drawn must not silence the onboarding standing behind it.
  const welcoming = awayProgress !== null && awayProgress.secondsApplied >= 5;

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
        {/*
          Onboarding only ever speaks over a world the player can see, and only
          while nothing else is already speaking. A hint under a Moment is a
          hint nobody reads, and one behind the boot gate is one nobody can act
          on.
        */}
        {playing && !welcoming && activeId === null && <CoachMark onOpen={setActiveId} />}
        {welcoming && playing && (
          <WelcomeBack summary={awayProgress} onDismiss={onDismissAwayProgress} />
        )}
        {playing && !welcoming && <PremiseGate />}
      </div>
      <BootGate phase={bootPhase} resumed={resumedFromSave} onBegin={onBegin} />
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

/**
 * The premise, shown once ever and then never again.
 *
 * It reads the flag out of the snapshot rather than out of a store of its own,
 * so an imported save arrives having already seen it - which is the point of
 * keeping the bit in `MetaState` rather than beside the volume sliders. A
 * player who moves to a new device is not a new player.
 */
function PremiseGate() {
  const run = useCommand();
  const seen = useSnapshotSelector((s) => s.storyFlags.includes(PREMISE_FLAG));
  if (seen) return null;
  return <Premise onDismiss={() => run({ type: 'mark_story_flag', flag: PREMISE_FLAG })} />;
}
