import { useRef, useState } from 'react';
import { big } from '../engine/numbers';
import { SPELL_TREE_NODE_BY_ID, SPELL_TREE_NODES, SPELL_TREE_ROOT_ID } from '../content/spellTree';
import { MAX_SPELL_TREE_POINTS, spellNodeStatus } from '../engine/spellTree/SpellTreeSystem';
import type { SimulationSnapshot } from '../engine/types';
import { layoutForSpellNode, SPELL_TREE_VIEWBOX } from './spellTree/SpellTreeLayout';
interface Props {
  snapshot: SimulationSnapshot;
  onBuyPoint: () => void;
  onActivateNode: (id: string) => void;
  onRespec: () => void;
}
const labels = {
  active: 'Awakened',
  available: 'Available · 1 point',
  exclusive: 'Locked by your choices · respec to change',
  requirements: 'Missing prerequisites',
  points: 'Need a Spell Point',
  unknown: 'Unavailable',
};
export function SpellTreeView({ snapshot: s, onBuyPoint, onActivateNode, onRespec }: Props) {
  const [selectedId, select] = useState(SPELL_TREE_ROOT_ID);
  const viewport = useRef<HTMLDivElement>(null);
  const selected = SPELL_TREE_NODE_BY_ID.get(selectedId)!;
  const state = { purchasedPoints: s.spellTreePurchasedPoints, activatedNodeIds: s.activeSpellNodeIds };
  const status = spellNodeStatus(state, selectedId);
  const full = s.spellTreeTotalPoints >= MAX_SPELL_TREE_POINTS;
  return (
    <div className="spell-tree-layout">
      <div className="spell-tree-toolbar">
        <div className="spell-point-wallet">
          <span className="eyebrow">SHAPE YOUR EVERCAST</span>
          <strong>
            {s.spellTreeUnspentPoints} unspent / {s.spellTreeTotalPoints} total
          </strong>
          <small>{s.essence.display} Arcane Essence</small>
        </div>
        <button
          className="buy-spell-point"
          onClick={onBuyPoint}
          disabled={full || big(s.essence.raw).cmp(s.nextSpellPointCost.raw) < 0}
        >
          {full ? 'All points purchased' : `Awaken Spell Point · ${s.nextSpellPointCost.display} Essence`}
        </button>
        <button className="respec-tree-button" onClick={onRespec} disabled={!s.activeSpellNodeIds.length}>
          Free Respec
        </button>
      </div>
      <p className="tree-instructions">
        Choose <b>one route</b>, then up to <b>two identities</b>. Side upgrades are optional. Each fusion
        needs <b>both mutations</b>. Scroll across to explore every route.
      </p>
      <nav className="tree-route-nav" aria-label="Explore spell routes">
        {SPELL_TREE_NODES.filter((n) => n.kind === 'route').map((n) => (
          <button
            key={n.id}
            className={`region-${n.region} ${spellNodeStatus(state, n.id)}`}
            onClick={() => {
              select(n.id);
              viewport.current?.scrollTo({
                left: layoutForSpellNode(n.id).x - viewport.current.clientWidth / 2,
                behavior: 'smooth',
              });
            }}
          >
            <strong>{n.name}</strong>
            <small>{labels[spellNodeStatus(state, n.id)]}</small>
          </button>
        ))}
      </nav>
      <div className="spell-tree-main">
        <div
          ref={viewport}
          className="spell-tree-viewport"
          tabIndex={0}
          aria-label="Spell tree, scroll to explore three routes"
        >
          <div className="spell-tree-canvas">
            <svg
              className="spell-tree-lines"
              viewBox={`0 0 ${SPELL_TREE_VIEWBOX.width} ${SPELL_TREE_VIEWBOX.height}`}
              aria-hidden="true"
            >
              {SPELL_TREE_NODES.flatMap((n) =>
                n.requiresAll.map((id) => {
                  const a = layoutForSpellNode(id),
                    b = layoutForSpellNode(n.id);
                  return (
                    <line
                      key={`${id}-${n.id}`}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      className={
                        spellNodeStatus(state, n.id) === 'active'
                          ? 'active'
                          : spellNodeStatus(state, id) === 'active'
                            ? 'reachable'
                            : ''
                      }
                    />
                  );
                }),
              )}
            </svg>
            {['twin', 'piercing', 'charged'].map((region, i) => (
              <div className={`route-caption region-${region}`} key={region} style={{ left: i * 600 }}>
                {
                  SPELL_TREE_NODES.filter(
                    (n) =>
                      n.region === region && n.kind === 'identity' && s.activeSpellNodeIds.includes(n.id),
                  ).length
                }{' '}
                / 2 identities chosen
              </div>
            ))}
            {SPELL_TREE_NODES.map((n) => {
              const p = layoutForSpellNode(n.id),
                status = spellNodeStatus(state, n.id);
              return (
                <button
                  key={n.id}
                  type="button"
                  aria-label={`${n.name}: ${labels[status]}`}
                  aria-pressed={selectedId === n.id}
                  className={`spell-node region-${n.region} kind-${n.kind} ${status} ${selectedId === n.id ? 'selected' : ''}`}
                  style={{ left: p.x, top: p.y }}
                  onClick={() => select(n.id)}
                  title={`${n.name} — ${labels[status]}`}
                >
                  <small>
                    {status === 'active' ? '✓ ' : status === 'exclusive' ? '× ' : ''}
                    {n.kind === 'minor' ? 'UPGRADE' : n.kind.toUpperCase()}
                  </small>
                  <span>{n.name}</span>
                </button>
              );
            })}
          </div>
        </div>
        <aside className={`spell-node-detail region-${selected.region}`} aria-live="polite">
          <span className="eyebrow">
            {selected.kind.toUpperCase()} · {selected.region.toUpperCase()}
          </span>
          <h3>{selected.name}</h3>
          <p>{selected.description}</p>
          <div className="node-status-row">
            <strong>{labels[status]}</strong>
          </div>
          {!!selected.requiresAll.length && (
            <div className="node-requirements">
              <h4>Requires {selected.requiresAll.length > 1 ? 'ALL' : ''}</h4>
              {selected.requiresAll.map((id) => (
                <div key={id}>
                  {spellNodeStatus(state, id) === 'active' ? '✓' : '○'} {SPELL_TREE_NODE_BY_ID.get(id)!.name}
                </div>
              ))}
            </div>
          )}
          {selected.exclusiveGroup && (
            <p>
              {selected.kind === 'route'
                ? 'Choose 1 of 3 routes.'
                : 'Choose up to 2 of 3 identities in this route.'}{' '}
              Free Respec returns all allocated points.
            </p>
          )}
          {status !== 'active' && (
            <button
              className="activate-spell-node"
              disabled={status !== 'available'}
              onClick={() => onActivateNode(selectedId)}
            >
              Awaken Node · 1 Point
            </button>
          )}
          <div className="spell-build-readout">
            <h4>Current Evercast</h4>
            <div>
              <span>Route</span>
              <strong>{s.spellMechanics?.route ?? 'base'}</strong>
            </div>
            <div>
              <span>Damage / projectile</span>
              <strong>{s.damagePerProjectile.display}</strong>
            </div>
            <div>
              <span>Cast interval</span>
              <strong>{s.castInterval.toFixed(2)}s</strong>
            </div>
            <div>
              <span>Projectiles</span>
              <strong>{s.projectileCount}</strong>
            </div>
            <div>
              <span>Critical</span>
              <strong>
                {Math.round(s.critChance * 100)}% · ×{s.critMultiplier.toFixed(2)}
              </strong>
            </div>
            {s.spellMechanics?.route === 'piercing' && (
              <div>
                <span>{s.spellMechanics.chain ? 'Chain hops' : 'Penetrations'}</span>
                <strong>{s.spellMechanics.penetrations}</strong>
              </div>
            )}
            {s.combatState && (
              <>
                <div>
                  <span>Momentum / Focus</span>
                  <strong>
                    {s.combatState.momentum} / {s.combatState.focus}
                  </strong>
                </div>
                <div>
                  <span>Supercharge</span>
                  <strong>{s.combatState.supercharge}</strong>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
