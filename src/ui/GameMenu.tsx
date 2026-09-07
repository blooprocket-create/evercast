import { useState } from 'react';
import { GEAR_EVOLUTION_MILESTONES } from '../engine/gear/GearCatalog';
import type { GearSlot } from '../engine/gear/types';
import type { GearSnapshot, SimulationSnapshot } from '../engine/types';

type MenuName = 'character' | 'tree' | 'gear';

interface GameMenuProps {
  snapshot: SimulationSnapshot;
  onLevelGear: (slot: GearSlot) => void;
}

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

export function GameMenu({ snapshot, onLevelGear }: GameMenuProps) {
  const [barOpen, setBarOpen] = useState(false);
  const [activeMenu, setActiveMenu] = useState<MenuName | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<GearSlot>('staff');
  const selectedGear = snapshot.gear.find((piece) => piece.slot === selectedSlot) ?? snapshot.gear[0];

  const openMenu = (menu: MenuName) => {
    setActiveMenu((current) => current === menu ? null : menu);
    setBarOpen(true);
  };

  return (
    <>
      <div className={`menu-bar ${barOpen ? 'open' : ''}`}>
        <button
          className="menu-toggle"
          type="button"
          aria-label="Toggle game menu"
          onClick={() => setBarOpen((open) => !open)}
        >
          {barOpen ? '×' : '☰'}
        </button>
        {barOpen && (
          <div className="menu-options">
            <button className={activeMenu === 'character' ? 'active' : ''} type="button" onClick={() => openMenu('character')}>Character</button>
            <button className={activeMenu === 'tree' ? 'active' : ''} type="button" onClick={() => openMenu('tree')}>Tree</button>
            <button className={activeMenu === 'gear' ? 'active' : ''} type="button" onClick={() => openMenu('gear')}>Gear</button>
          </div>
        )}
      </div>

      {activeMenu && (
        <section className="game-menu-panel">
          <header className="game-menu-header">
            <div>
              <span className="eyebrow">EVERCAST</span>
              <h2>{activeMenu === 'character' ? 'Character' : activeMenu === 'tree' ? 'Trees' : 'Gear'}</h2>
            </div>
            <div className="menu-wallet"><span>Gold</span><strong>{snapshot.gold.display}</strong></div>
            <button className="panel-close" type="button" onClick={() => setActiveMenu(null)}>×</button>
          </header>

          {activeMenu === 'character' && <CharacterPanel snapshot={snapshot} />}
          {activeMenu === 'tree' && <TreePanel gear={snapshot.gear} />}
          {activeMenu === 'gear' && selectedGear && (
            <GearPanel
              gear={snapshot.gear}
              selected={selectedGear}
              onSelect={setSelectedSlot}
              onLevelGear={onLevelGear}
            />
          )}
        </section>
      )}
    </>
  );
}

function CharacterPanel({ snapshot }: { snapshot: SimulationSnapshot }) {
  return (
    <div className="character-panel menu-scroll">
      <div className="character-summary">
        <Stat label="Health" value={`${snapshot.mageMaxHp.display}`} detail={`+${snapshot.gearHealthBonus.display} from gear`} />
        <Stat label="Arcane Bolt" value={snapshot.damagePerProjectile.display} detail={`${snapshot.spellBaseDamage.display} spell + ${snapshot.gearDamageBonus.display} gear`} />
        <Stat label="Cast Interval" value={`${snapshot.castInterval.toFixed(2)}s`} detail={`${snapshot.projectileCount} projectile${snapshot.projectileCount === 1 ? '' : 's'}`} />
        <Stat label="Frontier" value={`${snapshot.stage}`} detail={`Highest ${snapshot.highestStageEver}`} />
      </div>

      <div className="menu-section">
        <h3>Equipment Contribution</h3>
        <div className="contribution-list">
          {snapshot.gear.map((piece) => (
            <div className="contribution-row" key={piece.slot}>
              <span>{SLOT_LABELS[piece.slot]} · {piece.name} Lv. {piece.level}</span>
              <strong>+{piece.contribution.display} {piece.primaryStatLabel}</strong>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TreePanel({ gear }: { gear: GearSnapshot[] }) {
  return (
    <div className="tree-panel menu-scroll">
      <article className="tree-card spell-tree-card">
        <span className="eyebrow">SPELL</span>
        <h3>Evercast Spell Tree</h3>
        <p>The spell tree is intentionally not authored yet. This is where the one true spell will branch, mutate, and eventually become absurd.</p>
        <div className="tree-placeholder">Spell tree foundation reserved</div>
      </article>

      <div className="menu-section">
        <span className="eyebrow">GEAR</span>
        <h3>Gear Trees</h3>
        <p className="muted-copy">Gear level unlocks deeper tree tiers. The actual nodes and modifiers will be authored separately.</p>
        <div className="gear-tree-grid">
          {gear.map((piece) => (
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

interface GearPanelProps {
  gear: GearSnapshot[];
  selected: GearSnapshot;
  onSelect: (slot: GearSlot) => void;
  onLevelGear: (slot: GearSlot) => void;
}

function GearPanel({ gear, selected, onSelect, onLevelGear }: GearPanelProps) {
  return (
    <div className="gear-panel menu-scroll">
      <div className="paperdoll-wrap">
        <div className="paperdoll">
          <div className="paperdoll-mage" aria-hidden="true">
            <div className="paperdoll-head" />
            <div className="paperdoll-body" />
          </div>
          {gear.map((piece) => (
            <button
              key={piece.slot}
              type="button"
              className={`gear-slot slot-${piece.slot} ${selected.slot === piece.slot ? 'selected' : ''} evolution-${piece.evolutionTier}`}
              onClick={() => onSelect(piece.slot)}
            >
              <span>{SLOT_LABELS[piece.slot]}</span>
              <strong>Lv. {piece.level}</strong>
              <small>{piece.name}</small>
            </button>
          ))}
        </div>
      </div>

      <aside className="gear-detail">
        <span className="eyebrow">{SLOT_LABELS[selected.slot]} · Evolution {selected.evolutionTier + 1}</span>
        <h3>{selected.name}</h3>
        <p>{selected.description}</p>

        <div className="gear-level-block">
          <div><span>Gear Level</span><strong>{selected.level}</strong></div>
          <div><span>Current Contribution</span><strong>+{selected.contribution.display} {selected.primaryStatLabel}</strong></div>
          <div><span>Each Level</span><strong>+{selected.perLevel} {selected.primaryStatLabel}</strong></div>
        </div>

        <button className="level-gear-button" type="button" onClick={() => onLevelGear(selected.slot)}>
          Level Up · {selected.nextLevelCost.display} Gold
        </button>

        <div className="evolution-block">
          <div className="detail-heading"><span>Evolution</span><strong>{selected.nextEvolutionLevel ? `Next at Lv. ${selected.nextEvolutionLevel}` : 'Max test tier'}</strong></div>
          <div className="evolution-track">
            {GEAR_EVOLUTION_MILESTONES.map((milestone, index) => (
              <div key={milestone} className={selected.level >= milestone ? 'reached' : ''}>
                <span>{index + 1}</span>
                <small>Lv. {milestone}</small>
              </div>
            ))}
          </div>
        </div>

        <div className="gear-tree-info">
          <div className="detail-heading"><span>Gear Tree</span><strong>{selected.unlockedTreeTier} tiers unlocked</strong></div>
          {selected.treeNodes.length > 0 ? (
            <ul>{selected.treeNodes.map((node) => <li key={node}>{node}</li>)}</ul>
          ) : (
            <p className="muted-copy">No gear-tree modifiers selected yet. The state is ready for them; we still need to design the actual tree.</p>
          )}
        </div>
      </aside>
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="character-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
