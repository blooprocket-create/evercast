import { useMemo, useState } from 'react';
import type { SimulationSnapshot } from '../engine/types';
import {
  SPELL_TREE_NODE_BY_ID,
  SPELL_TREE_NODES,
  SPELL_TREE_ROOT_ID,
  adjacentNodeIds,
} from '../engine/spellTree/SpellTreeCatalog';
import { canActivateSpellNode, MAX_SPELL_TREE_POINTS } from '../engine/spellTree/SpellTreeSystem';
import type { SpellTreeState } from '../engine/spellTree/types';

interface SpellTreeViewProps {
  snapshot: SimulationSnapshot;
  onBuyPoint: () => void;
  onActivateNode: (nodeId: string) => void;
  onRespec: () => void;
}

export function SpellTreeView({ snapshot, onBuyPoint, onActivateNode, onRespec }: SpellTreeViewProps) {
  const [selectedNodeId, setSelectedNodeId] = useState(SPELL_TREE_ROOT_ID);
  const selected = SPELL_TREE_NODE_BY_ID.get(selectedNodeId) ?? SPELL_TREE_NODE_BY_ID.get(SPELL_TREE_ROOT_ID)!;
  const state: SpellTreeState = useMemo(() => ({
    purchasedPoints: snapshot.spellTreePurchasedPoints,
    activatedNodeIds: snapshot.activeSpellNodeIds,
  }), [snapshot.spellTreePurchasedPoints, snapshot.activeSpellNodeIds]);
  const active = useMemo(() => new Set([SPELL_TREE_ROOT_ID, ...snapshot.activeSpellNodeIds]), [snapshot.activeSpellNodeIds]);
  const revealed = useMemo(() => revealedNodes(active), [active]);
  const canActivateSelected = canActivateSpellNode(state, selected.id);
  const treeFullyFunded = snapshot.spellTreeTotalPoints >= MAX_SPELL_TREE_POINTS;

  return (
    <div className="spell-tree-layout">
      <div className="spell-tree-toolbar">
        <div className="spell-point-wallet">
          <span className="eyebrow">EVERCAST POWER</span>
          <strong>{snapshot.spellTreeUnspentPoints} unspent / {snapshot.spellTreeTotalPoints} total</strong>
          <small>{snapshot.essence.display} Arcane Essence available</small>
        </div>
        <button className="buy-spell-point" type="button" onClick={onBuyPoint} disabled={treeFullyFunded}>
          {treeFullyFunded
            ? 'All Spell Points Awakened'
            : `Awaken Spell Point · ${snapshot.nextSpellPointCost.display} Essence`}
        </button>
        <button className="respec-tree-button" type="button" onClick={onRespec} disabled={snapshot.activeSpellNodeIds.length === 0}>
          Free Respec
        </button>
      </div>

      <div className="spell-tree-main">
        <div className="spell-tree-viewport">
          <div className="spell-tree-canvas">
            <svg className="spell-tree-lines" viewBox="0 0 1000 760" preserveAspectRatio="none" aria-hidden="true">
              {SPELL_TREE_NODES.flatMap((node) => node.requires.map((parentId) => {
                const parent = SPELL_TREE_NODE_BY_ID.get(parentId);
                if (!parent || !revealed.has(node.id) || !revealed.has(parentId)) return null;
                const connected = active.has(node.id) && active.has(parentId);
                const reachable = active.has(parentId) || active.has(node.id);
                return (
                  <line
                    key={`${parentId}-${node.id}`}
                    x1={parent.x} y1={parent.y} x2={node.x} y2={node.y}
                    className={connected ? 'active' : reachable ? 'reachable' : ''}
                  />
                );
              }))}
            </svg>

            {SPELL_TREE_NODES.map((node) => {
              if (!revealed.has(node.id)) return null;
              const isActive = active.has(node.id);
              const canActivate = canActivateSpellNode(state, node.id);
              const isAdjacent = node.requires.some((id) => active.has(id)) || adjacentNodeIds(node.id).some((id) => active.has(id));
              return (
                <button
                  key={node.id}
                  type="button"
                  className={`spell-node region-${node.region} kind-${node.kind} ${isActive ? 'active' : ''} ${canActivate ? 'available' : ''} ${isAdjacent ? 'adjacent' : ''} ${selected.id === node.id ? 'selected' : ''}`}
                  style={{ left: `${node.x / 10}%`, top: `${node.y / 7.6}%` }}
                  onClick={() => setSelectedNodeId(node.id)}
                  title={node.name}
                >
                  <span>{node.kind === 'root' ? 'EVERCAST' : node.kind === 'mutation' ? '◆' : node.kind === 'notable' ? '✦' : '•'}</span>
                </button>
              );
            })}

            <span className="tree-region-label label-arcane">ARCANE</span>
            <span className="tree-region-label label-fire">FIRE</span>
            <span className="tree-region-label label-frost">FROST</span>
            <span className="tree-region-label label-storm">STORM</span>
            <span className="tree-region-label label-blood">BLOOD</span>
          </div>
        </div>

        <aside className={`spell-node-detail region-${selected.region}`}>
          <span className="eyebrow">{selected.kind.toUpperCase()} · {selected.region.toUpperCase()}</span>
          <h3>{selected.name}</h3>
          <p>{selected.description}</p>
          <div className="node-status-row">
            <span>Status</span>
            <strong>
              {active.has(selected.id)
                ? 'Awakened'
                : canActivateSelected
                  ? 'Available'
                  : snapshot.spellTreeUnspentPoints <= 0
                    ? 'Need a Spell Point'
                    : 'Path not connected'}
            </strong>
          </div>
          {selected.id !== SPELL_TREE_ROOT_ID && !active.has(selected.id) && (
            <button
              className="activate-spell-node"
              type="button"
              disabled={!canActivateSelected}
              onClick={() => onActivateNode(selected.id)}
            >
              Awaken Node · 1 Point
            </button>
          )}

          <div className="spell-build-readout">
            <h4>Current Evercast</h4>
            <div><span>Damage</span><strong>{snapshot.damagePerProjectile.display}</strong></div>
            <div><span>Cast</span><strong>{snapshot.castInterval.toFixed(2)}s</strong></div>
            <div><span>Projectiles</span><strong>{snapshot.projectileCount}</strong></div>
            <div><span>Critical</span><strong>{Math.round(snapshot.critChance * 100)}% · ×{snapshot.critMultiplier.toFixed(2)}</strong></div>
            <div><span>Pierce</span><strong>{snapshot.pierceTargets}</strong></div>
            <div><span>Splash</span><strong>{snapshot.splashTargets}{snapshot.splashTargets > 0 ? ` @ ${Math.round(snapshot.splashDamageMultiplier * 100)}%` : ''}</strong></div>
            <div><span>Chain</span><strong>{snapshot.chainTargets}{snapshot.chainTargets > 0 ? ` @ ${Math.round(snapshot.chainDamageMultiplier * 100)}%` : ''}</strong></div>
            <div><span>Control</span><strong>+{snapshot.controlDelaySeconds.toFixed(2)}s delay / hit</strong></div>
            <div><span>Leech</span><strong>{Math.round(snapshot.leechFraction * 100)}%</strong></div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function revealedNodes(active: ReadonlySet<string>): Set<string> {
  const revealed = new Set<string>([SPELL_TREE_ROOT_ID]);
  const queue: Array<{ id: string; depth: number }> = [...active].map((id) => ({ id, depth: 0 }));
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    revealed.add(current.id);
    if (current.depth >= 2) continue;
    for (const adjacent of adjacentNodeIds(current.id)) {
      revealed.add(adjacent);
      queue.push({ id: adjacent, depth: current.depth + 1 });
    }
  }
  return revealed;
}
