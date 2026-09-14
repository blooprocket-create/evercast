import { useMemo, useRef, useState } from 'react';
import {
  SPELL_ATTUNEMENT_BY_ID,
  SPELL_TREE_NODES,
  SPELL_TREE_NODE_BY_ID,
  SPELL_TREE_ROOT_ID,
} from '../../content/spellTree';
import { big, formatBig } from '../../engine/numbers';
import { blockingAttunement } from '../../engine/spellTree/SpellTreeSystem';
import type { SpellTreeState } from '../../engine/spellTree/types';
import { Graph, type EdgeTone } from '../archetypes/Graph';
import { Moment } from '../archetypes/Moment';
import { NumberCell } from '../format/NumberCell';
import { affordabilityLabel } from '../format/timeToAfford';
import type { GraphBox } from '../graph/layoutGraph';
import { shouldShowSearch } from '../graph/fitView';
import { Button } from '../primitives/Button';
import { useCommand } from '../state/CommandContext';
import { useSnapshot } from '../state/snapshot';
import { spellNodeStatuses, spellTreeStateKey } from '../spellTree/spellNodeStatuses';
import { LABELLED_KINDS, SPELL_TREE_LAYOUT } from '../spellTree/spellTreeGraph';
import { projectNode } from '../spellTree/spellDps';
import { effectiveDps } from '../format/dps';
import styles from './SpellTreeSurface.module.css';

const KIND_LABEL: Record<string, string> = {
  root: 'Core',
  route: 'Route',
  identity: 'Identity',
  minor: 'Upgrade',
  mutation: 'Mutation',
  fusion: 'Fusion',
  apex: 'Apex',
};

/**
 * Which names are worth drawing at a given zoom.
 *
 * 127 labels at the fitted zoom is not a labelled graph, it is a texture - the
 * audit measured them at 3-4px, and they are counter-scaled now so they would
 * be 127 legible labels on top of each other instead. The ladder is the
 * content's own hierarchy: the routes are always named, the identities and
 * capstones arrive when there is room for them, and the rest when the player
 * has zoomed in far enough to be choosing between them.
 *
 * The selected node and every search hit are named regardless. Those are the
 * two cases where the player is already looking for one in particular.
 */
const LABEL_ZOOM: Record<string, number> = {
  root: 0,
  route: 0,
  apex: 0.3,
  identity: 0.34,
  fusion: 0.5,
  mutation: 0.5,
};

function labelAtZoom(kind: string, scale: number): boolean {
  if (!LABELLED_KINDS.has(kind as never)) return false;
  const threshold = LABEL_ZOOM[kind];
  return threshold !== undefined && scale >= threshold;
}

const STATUS_NOTE: Record<string, string> = {
  active: 'Awakened',
  available: 'Available for one point',
  exclusive: 'Locked by your choices - respec to change',
  requirements: 'Missing prerequisites',
  points: 'Needs a spell point',
  unknown: 'Unavailable',
};

export function SpellTreeSurface() {
  const snapshot = useSnapshot();
  const run = useCommand();
  const [selectedId, setSelectedId] = useState<string>(SPELL_TREE_ROOT_ID);
  const [query, setQuery] = useState('');
  const [respeccing, setRespeccing] = useState(false);
  const focusRef = useRef<((box: GraphBox) => void) | null>(null);

  const state: SpellTreeState = {
    purchasedPoints: snapshot.spellTreePurchasedPoints,
    activatedNodeIds: snapshot.activeSpellNodeIds,
    attunements: snapshot.ownedAttunementIds,
  };

  // The array is new on every snapshot build, so memoize on a value-stable key.
  const key = spellTreeStateKey(state);
  const statuses = useMemo(() => spellNodeStatuses(state), [key]);

  const selected = SPELL_TREE_NODE_BY_ID.get(selectedId) ?? SPELL_TREE_NODE_BY_ID.get(SPELL_TREE_ROOT_ID)!;
  const status = statuses.get(selected.id) ?? 'unknown';

  // The same number the dashboard shows, so the two never disagree.
  const currentDps = useMemo(() => effectiveDps(snapshot), [snapshot]);

  const projection = useMemo(
    () =>
      status === 'active'
        ? null
        : projectNode(state, selected.id, snapshot.gearDamageBonus.raw, currentDps),
    [key, selected.id, status, snapshot.gearDamageBonus.raw, currentDps],
  );

  const matches = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (trimmed.length < 2) return new Set<string>();
    return new Set(
      SPELL_TREE_NODES.filter((node) => node.name.toLowerCase().includes(trimmed)).map((n) => n.id),
    );
  }, [query]);

  const edgeTone = (from: string, to: string): EdgeTone => {
    if (statuses.get(to) === 'active') return 'active';
    if (statuses.get(from) === 'active') return 'reachable';
    return 'idle';
  };

  const nodeTone = (id: string): string => {
    const nodeStatus = statuses.get(id);
    if (nodeStatus === 'active') return 'var(--accent)';
    if (nodeStatus === 'available') return 'var(--route)';
    return 'var(--ink-dim)';
  };

  const pointWait = affordabilityLabel(
    snapshot.nextSpellPointCost.raw,
    snapshot.essence.raw,
    snapshot.income.essence?.raw,
  );

  const affordablePoint =
    snapshot.spellTreeTotalPoints < snapshot.spellTreeMaxPoints &&
    big(snapshot.essence.raw).cmp(big(snapshot.nextSpellPointCost.raw)) >= 0;

  // Which unlock would widen whatever is blocking the selected node, so the
  // inspector can name it instead of telling the player to respec in vain.
  const blocker = useMemo(
    () => (status === 'exclusive' ? blockingAttunement(state, selected.id) : null),
    [key, selected.id, status],
  );

  return (
    <>
      <Graph
        layout={SPELL_TREE_LAYOUT}
        focusRef={(focus) => {
          focusRef.current = focus;
        }}
        edgeTone={edgeTone}
        nodeTone={nodeTone}
        edgeAnchor="centre"
        renderNode={(box, view) => {
          const node = SPELL_TREE_NODE_BY_ID.get(box.id);
          if (!node) return null;
          const nodeStatus = statuses.get(box.id) ?? 'unknown';
          const classes = [styles.node, styles[nodeStatus]];
          if (box.id === selected.id) classes.push(styles.selected);
          if (matches.has(box.id)) classes.push(styles.match);
          const labelled =
            box.id === selected.id || matches.has(box.id) || labelAtZoom(node.kind, view.scale);
          return (
            <button
              type="button"
              className={classes.filter(Boolean).join(' ')}
              onClick={() => setSelectedId(box.id)}
              title={`${node.name} \u00b7 ${STATUS_NOTE[nodeStatus]}`}
              aria-label={`${node.name}: ${STATUS_NOTE[nodeStatus]}`}
              aria-pressed={box.id === selected.id}
            >
              {labelled && (
                /*
                  Counter-scaled, so a label is the size it was authored at
                  whatever the zoom - it used to shrink with the graph and was
                  3-4px of noise at the fitted zoom.
                */
                <span
                  className={styles.name}
                  style={{ '--label-scale': 'var(--graph-inverse-scale, 1)' } as React.CSSProperties}
                >
                  {node.name}
                </span>
              )}
            </button>
          );
        }}
        toolbar={
          <>
            <span className={`${styles.chip} ${styles.unspent}`}>
              <span className={styles.unspentValue}>{snapshot.spellTreeUnspentPoints}</span>
              unspent
            </span>
            <Button
              variant="primary"
              disabled={!affordablePoint}
              onClick={() => run({ type: 'buy_spell_point' })}
            >
              Awaken point &middot; {snapshot.nextSpellPointCost.display}
              {/* What the price costs in time; nothing while the meter is cold. */}
              {pointWait !== null && <span className={styles.wait}>{pointWait}</span>}
            </Button>
            <Button
              disabled={snapshot.activeSpellNodeIds.length === 0}
              onClick={() => setRespeccing(true)}
            >
              Respec
            </Button>
            <span className={styles.spacer} />
            {shouldShowSearch(SPELL_TREE_NODES.length) && (
              <input
                className={styles.search}
                type="search"
                value={query}
                placeholder={`Search ${SPELL_TREE_NODES.length} nodes`}
                onChange={(event) => {
                  const next = event.target.value;
                  setQuery(next);
                  const trimmed = next.trim().toLowerCase();
                  if (trimmed.length < 2) return;
                  const hit = SPELL_TREE_NODES.find((node) =>
                    node.name.toLowerCase().includes(trimmed),
                  );
                  const box = hit && SPELL_TREE_LAYOUT.boxes.get(hit.id);
                  if (box) {
                    setSelectedId(hit.id);
                    focusRef.current?.(box);
                  }
                }}
              />
            )}
          </>
        }
        inspector={
          <>
            <span className={styles.eyebrow}>
              {KIND_LABEL[selected.kind] ?? selected.kind} &middot; {selected.region}
            </span>
            <h3 className={styles.title}>{selected.name}</h3>
            <p className={styles.description}>{selected.description}</p>

            {projection && (
              <div className={styles.impact}>
                <span className={styles.eyebrow}>If you awaken this</span>
                {projection.percent !== null && projection.percent !== 0 ? (
                  <>
                    <div className={styles.impactRow}>
                      <span>Effective DPS</span>
                      <span>
                        <span className={styles.before}>{formatBig(currentDps)}</span>{' '}
                        <span className={styles.after}>{formatBig(projection.projected)}</span>
                      </span>
                    </div>
                    <div className={styles.impactRow}>
                      <span>Change</span>
                      <span className={styles.after}>
                        {projection.percent > 0 ? '+' : ''}
                        {projection.percent}%
                      </span>
                    </div>
                  </>
                ) : (
                  <p className={styles.note}>
                    No change to single-target damage per second. This one is felt elsewhere.
                  </p>
                )}
                {projection.changes.length > 0 && (
                  <div className={styles.impactRow}>
                    <span>Changes</span>
                    <span className={styles.changes}>{projection.changes.join(', ')}</span>
                  </div>
                )}
              </div>
            )}

            {selected.requiresAll.length > 0 && (
              <div className={styles.requires}>
                <span className={styles.eyebrow} style={{ color: 'var(--ink-low)' }}>
                  Requires
                </span>
                {selected.requiresAll.map((id) => {
                  const met = statuses.get(id) === 'active';
                  return (
                    <span key={id} className={styles.requirement}>
                      <span className={met ? styles.met : undefined}>{met ? '\u2713' : '\u25cb'}</span>
                      {SPELL_TREE_NODE_BY_ID.get(id)?.name ?? id}
                    </span>
                  );
                })}
              </div>
            )}

            {status !== 'active' && (
              <Button
                variant="primary"
                disabled={status !== 'available'}
                onClick={() => run({ type: 'activate_spell_node', nodeId: selected.id })}
              >
                {status === 'available' ? 'Awaken - 1 point' : STATUS_NOTE[status]}
              </Button>
            )}

            {blocker && (
              <p className={styles.note}>
                Respec swaps which one you hold. To hold both, attune{' '}
                <strong>{SPELL_ATTUNEMENT_BY_ID.get(blocker)?.name ?? blocker}</strong>.
              </p>
            )}

            <p className={styles.note}>
              <NumberCell value={String(snapshot.spellTreeTotalPoints)} inline /> of{' '}
              {snapshot.spellTreeMaxPoints} points awakened.
              {selected.exclusiveGroup
                ? ' Choices in this group lock the others until you respec.'
                : ''}
            </p>
          </>
        }
      />
      {/*
        Respec sat in the toolbar as an ordinary secondary button that undid
        every allocation the instant it was pressed, with no confirmation and no
        undo. Late game that is 105 points of build, and the toolbar it lives in
        scrolls sideways on a phone - so a mistimed tap while panning to the
        search field was a plausible way to lose it. Same treatment as Rebirth
        and Erase progress: a danger moment, itemised, opening on the safe half.
      */}
      {respeccing && (
        <Moment
          tone="danger"
          icon="spellTree"
          headline="Return every point?"
          consequence="Every awakened node is returned at once - the route you committed to, and everything you built past it. The points are kept and can be spent again from anywhere in the tree. Attunements, gear and companions are untouched, and the Essence the points cost is not refunded."
          cells={[
            { label: 'Awakened', value: String(snapshot.activeSpellNodeIds.length) },
            {
              label: 'Points to spend',
              value: `${snapshot.spellTreeUnspentPoints} to ${snapshot.spellTreeTotalPoints}`,
            },
          ]}
          primary={{
            label: 'Return them',
            onClick: () => {
              setRespeccing(false);
              setSelectedId(SPELL_TREE_ROOT_ID);
              run({ type: 'respec_spell_tree' });
            },
          }}
          secondary={{ label: 'Keep this build', onClick: () => setRespeccing(false) }}
          onDismiss={() => setRespeccing(false)}
        />
      )}
    </>
  );
}
