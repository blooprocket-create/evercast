import { useMemo, useRef, useState } from 'react';
import {
  SPELL_TREE_NODES,
  SPELL_TREE_NODE_BY_ID,
  SPELL_TREE_ROOT_ID,
} from '../../content/spellTree';
import { big, formatBig } from '../../engine/numbers';
import { MAX_SPELL_TREE_POINTS } from '../../engine/spellTree/SpellTreeSystem';
import type { SpellTreeState } from '../../engine/spellTree/types';
import { Graph, type EdgeTone } from '../archetypes/Graph';
import { NumberCell } from '../format/NumberCell';
import type { GraphBox } from '../graph/layoutGraph';
import { shouldShowSearch } from '../graph/fitView';
import { Button } from '../primitives/Button';
import { useCommand } from '../state/CommandContext';
import { useSnapshot } from '../state/snapshot';
import { spellNodeStatuses, spellTreeStateKey } from '../spellTree/spellNodeStatuses';
import { SPELL_TREE_LAYOUT } from '../spellTree/spellTreeGraph';
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
};

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
  const focusRef = useRef<((box: GraphBox) => void) | null>(null);

  const state: SpellTreeState = {
    purchasedPoints: snapshot.spellTreePurchasedPoints,
    activatedNodeIds: snapshot.activeSpellNodeIds,
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

  const affordablePoint =
    snapshot.spellTreeTotalPoints < MAX_SPELL_TREE_POINTS &&
    big(snapshot.essence.raw).cmp(big(snapshot.nextSpellPointCost.raw)) >= 0;

  return (
    <Graph
      layout={SPELL_TREE_LAYOUT}
      focusRef={(focus) => {
        focusRef.current = focus;
      }}
      edgeTone={edgeTone}
      nodeTone={nodeTone}
      renderNode={(box) => {
        const node = SPELL_TREE_NODE_BY_ID.get(box.id);
        if (!node) return null;
        const nodeStatus = statuses.get(box.id) ?? 'unknown';
        const classes = [styles.node, styles[nodeStatus]];
        if (box.id === selected.id) classes.push(styles.selected);
        if (matches.has(box.id)) classes.push(styles.match);
        return (
          <button
            type="button"
            className={classes.filter(Boolean).join(' ')}
            onClick={() => setSelectedId(box.id)}
            title={`${node.name} - ${STATUS_NOTE[nodeStatus]}`}
            aria-pressed={box.id === selected.id}
          >
            <span className={styles.kind}>{KIND_LABEL[node.kind] ?? node.kind}</span>
            <span className={styles.name}>{node.name}</span>
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
          </Button>
          <Button
            disabled={snapshot.activeSpellNodeIds.length === 0}
            onClick={() => run({ type: 'respec_spell_tree' })}
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

          <p className={styles.note}>
            <NumberCell value={String(snapshot.spellTreeTotalPoints)} inline /> of{' '}
            {MAX_SPELL_TREE_POINTS} points awakened.
            {selected.exclusiveGroup
              ? ' Choices in this group lock the others until you respec.'
              : ''}
          </p>
        </>
      }
    />
  );
}
