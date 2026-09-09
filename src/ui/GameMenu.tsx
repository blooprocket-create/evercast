/**
 * What remains of the old menu: the spell-tree panel, kept alive inside the
 * new shell until the Graph archetype replaces it. The gear paperdoll that
 * used to live here is gone - it pinned eight slots at hardcoded pixel
 * offsets and so could never hold a ninth.
 */
import { GEAR_EVOLUTION_MILESTONES } from '../engine/gear/GearCatalog';
import type { GearSlot } from '../engine/gear/types';
import type { SimulationSnapshot } from '../engine/types';
import { SpellTreeView } from './SpellTreeView';


const SLOT_LABELS: Record<GearSlot, string> = {
  helm: 'Helm',
  staff: 'Staff',
  spellbook: 'Spellbook',
  robe: 'Robe',
  boots: 'Boots',
  necklace: 'Necklace',
  ringLeft: 'Ring I',
  ringRight: 'Ring II',
};

export function TreePanel({
  snapshot,
  onBuySpellPoint,
  onActivateSpellNode,
  onRespecSpellTree,
}: {
  snapshot: SimulationSnapshot;
  onBuySpellPoint: () => void;
  onActivateSpellNode: (nodeId: string) => void;
  onRespecSpellTree: () => void;
}) {
  return (
    <div className="tree-panel menu-scroll">
      <SpellTreeView
        snapshot={snapshot}
        onBuyPoint={onBuySpellPoint}
        onActivateNode={onActivateSpellNode}
        onRespec={onRespecSpellTree}
      />

      <div className="menu-section gear-tree-section">
        <span className="eyebrow">GEAR</span>
        <h3>Gear Trees</h3>
        <p className="muted-copy">Gear level unlocks deeper tree tiers. The actual gear-tree nodes remain deliberately un-authored while we playtest the Evercast tree.</p>
        <div className="gear-tree-grid">
          {snapshot.gear.map((piece) => (
            <article className="tree-card" key={piece.slot}>
              <div className="tree-card-heading">
                <strong>{SLOT_LABELS[piece.slot]}</strong>
                <span>Tier {piece.unlockedTreeTier} / {GEAR_EVOLUTION_MILESTONES.length}</span>
              </div>
              <small>{piece.name} · Lv. {piece.level}</small>
              <div className="tree-tier-track">
                {GEAR_EVOLUTION_MILESTONES.map((milestone, index) => (
                  <span
                    key={milestone}
                    className={piece.level >= milestone ? 'unlocked' : ''}
                    title={`Gear level ${milestone}`}
                  >
                    {index + 1}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
