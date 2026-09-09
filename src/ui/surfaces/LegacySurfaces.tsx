import { useState } from 'react';
import type { GearSlot } from '../../engine/gear/types';
import { GearPanel, TreePanel } from '../GameMenu';
import { useCommand } from '../state/CommandContext';
import { useSnapshot } from '../state/snapshot';

/**
 * The spell tree and gear panels exactly as they were, rendered inside the new
 * shell. They keep working while the Graph and Detail archetypes are built, so
 * every phase of the rewrite ships a game that runs.
 */

export function LegacyTreeSurface() {
  const snapshot = useSnapshot();
  const run = useCommand();
  return (
    <div className="menu-scroll">
      <TreePanel
        snapshot={snapshot}
        onBuySpellPoint={() => run({ type: 'buy_spell_point' })}
        onActivateSpellNode={(nodeId) => run({ type: 'activate_spell_node', nodeId })}
        onRespecSpellTree={() => run({ type: 'respec_spell_tree' })}
      />
    </div>
  );
}

export function LegacyGearSurface() {
  const snapshot = useSnapshot();
  const run = useCommand();
  const [selectedSlot, setSelectedSlot] = useState<GearSlot>('staff');
  const selected = snapshot.gear.find((piece) => piece.slot === selectedSlot) ?? snapshot.gear[0];
  if (!selected) return null;
  return (
    <div className="menu-scroll">
      <GearPanel
        gear={snapshot.gear}
        selected={selected}
        onSelect={setSelectedSlot}
        onLevelGear={(slot) => run({ type: 'level_gear', slot })}
      />
    </div>
  );
}
