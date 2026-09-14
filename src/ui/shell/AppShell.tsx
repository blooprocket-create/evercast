import { useEffect, useMemo, useRef, useState } from 'react';
import type { BootPhase } from '../../app/BootPhase';
import { accentForZone, accentInkVariable, accentVariable } from '../theme/biome';
import { BootGate } from './BootGate';
import { CoachMark } from '../onboarding/CoachMark';
import { HudOverlay, ShelfLog, ShelfVitals } from './HudOverlay';
import { FIRST_DEFEAT_FLAG, PREMISE_FLAG } from '../onboarding/flags';
import { Premise } from '../surfaces/Premise';
import { WelcomeBack } from '../surfaces/WelcomeBack';
import { SurfaceHost } from './SurfaceHost';
import { Toasts, useToasts } from './Toasts';
import { useDefeat } from './useDefeat';
import { Moment } from '../archetypes/Moment';
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

/**
 * How long an absence has to be before it is worth a full-screen moment.
 *
 * It was five seconds, and the visibility handler credits time spent in a
 * background tab - so alt-tabbing for six seconds came back to a modal
 * reporting, in the old formatter's words, "0 minutes". A minute is the point
 * at which there is something to report; below it the run simply carries on,
 * which is the whole promise of the game.
 */
const WELCOME_BACK_SECONDS = 60;

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
  const welcoming = awayProgress !== null && awayProgress.secondsApplied >= WELCOME_BACK_SECONDS;
  const { toasts, raise, expire } = useToasts();
  const defeat = useDefeat();

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
        <Toasts toasts={toasts} onExpire={expire} />
        {welcoming && playing && (
          <WelcomeBack summary={awayProgress} onDismiss={onDismissAwayProgress} />
        )}
        {playing && !welcoming && <PremiseGate />}
        {playing && !welcoming && <DefeatGate defeat={defeat} onToast={raise} />}
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
 * What the game says when the mage falls.
 *
 * Nothing said anything. The only failure state in the game produced one log
 * line that the next event overwrote a second later - and on any phone that
 * log is not rendered at all - plus a pill quietly changing to `FARMING n` and
 * a bright `Retry Frontier` button appearing beside the wallets, unannounced.
 * A new player's first death was a button they were not told about next to a
 * word nobody explained.
 *
 * The first one is a Moment, because it is the one that has to teach the loop.
 * Every one after it is a toast, because death *is* the loop and a full screen
 * each time would be the worse bug.
 */
function DefeatGate({
  defeat,
  onToast,
}: {
  defeat: ReturnType<typeof useDefeat>;
  onToast: (toast: Parameters<typeof Toasts>[0]['toasts'][number]) => void;
}) {
  const run = useCommand();
  const explained = useSnapshotSelector((s) => s.storyFlags.includes(FIRST_DEFEAT_FLAG));
  const announced = useRef<number | null>(null);

  const first = defeat !== null && !explained;

  useEffect(() => {
    if (defeat === null || first) return;
    if (announced.current === defeat.serial) return;
    announced.current = defeat.serial;
    onToast({
      id: `defeat-${defeat.serial}`,
      tone: 'defeat',
      icon: 'rebirth',
      title: `The frontier held at ${defeat.stage}`,
      detail: `${defeat.enemy} finished it. Farming ${defeat.farmStage} until the mage is stronger.`,
    });
  }, [defeat, first, onToast]);

  if (!first || defeat === null) return null;

  return (
    <Moment
      tone="danger"
      icon="rebirth"
      headline="The mage falls"
      consequence={`${defeat.enemy} finished it at Frontier ${defeat.stage}. Nothing is lost - the Evercast drops back to ${defeat.farmStage} and keeps killing until it is strong enough to try again.`}
      cells={[
        { label: 'Reached', value: String(defeat.stage) },
        { label: 'Farming', value: String(defeat.farmStage) },
      ]}
      primary={{
        label: 'Keep casting',
        onClick: () => run({ type: 'mark_story_flag', flag: FIRST_DEFEAT_FLAG }),
      }}
      hint="Retry Frontier sends it straight back up. It will go on its own once it can."
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
