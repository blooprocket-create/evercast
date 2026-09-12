import { useMemo, useState } from 'react';
import type { BootPhase } from '../../app/BootPhase';
import { accentForZone, accentInkVariable, accentVariable } from '../theme/biome';
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
  /** The scene has the title void on screen; the gate may lift its curtain. */
  titleLit: boolean;
  onBegin: () => void;
  awayProgress: OfflineSummary | null;
  onDismissAwayProgress: () => void;
}

export function AppShell({
  canvasRef,
  bootPhase,
  resumedFromSave,
  titleLit,
  onBegin,
  awayProgress,
  onDismissAwayProgress,
}: AppShellProps) {
  const registry = useMemo(() => loadRegistry(), []);
  const [activeId, setActiveId] = useState<string | null>(null);

  // The interface wears the accent of the zone the player is standing in.
  const zone = useSnapshotSelector((s) => s.zone);
  const biome = accentForZone(zone);
  const accent = accentVariable(biome);
  // Text takes the legible variant of the same accent; chrome keeps the
  // authored one. See `accentInkVariable`.
  const accentInk = accentInkVariable(biome);
  const playing = bootPhase === 'playing';
  // The threshold is the away report's own, not a second guess at it: a moment
  // that is not drawn must not silence the onboarding standing behind it.
  const welcoming = awayProgress !== null && awayProgress.secondsApplied >= 5;

  return (
    <main
      className={styles.shell}
      style={{ '--accent': accent, '--accent-ink': accentInk } as React.CSSProperties}
    >
      {/*
        `role="img"` rather than a bare label: a canvas with no role is a
        generic element, and a name on one is not reliably announced. The
        diorama draws no text and nothing in it is only available there - the
        HUD carries the frontier, the wallets, both health bars and the enemy,
        and the shelf log narrates what happens as it happens - so this
        describes the picture and points at the readable copy rather than
        pretending to transcribe a 3D scene.
      */}
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        role="img"
        /*
          The label follows what is actually drawn. Before the player begins,
          the camera is parked above the world and the canvas carries the title
          sigil - describing a mage and an oncoming wave there would be a
          description of something not on screen.
        */
        aria-label={
          titleLit && !playing
            ? 'An arcane sigil: three slowly turning rings of violet light around a bright core, drawn in 3D over darkness.'
            : 'The Evercast diorama: the mage, the companions and the oncoming wave, drawn in 3D. Everything it shows is also written in the heads-up display and the log beneath it.'
        }
      />
      {/*
        `aria-modal` on the gate is a promise to assistive technology, not a
        mechanism: it makes nothing inert and traps no focus. The shelf renders
        before the gate in DOM order and its buttons stay focusable, so Tab used
        to walk straight into Character, Spell Tree and Gear behind an opaque
        overlay - reachable, activatable, and completely invisible. `inert` is
        the platform's own answer, and it costs one attribute.
      */}
      <div className={styles.layer} inert={!playing}>
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
      <BootGate phase={bootPhase} resumed={resumedFromSave} lit={titleLit} onBegin={onBegin} />
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
