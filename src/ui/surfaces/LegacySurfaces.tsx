import { TreePanel } from '../GameMenu';
import { useCommand } from '../state/CommandContext';
import { useSnapshot } from '../state/snapshot';

/**
 * The spell tree panel exactly as it was, rendered inside the new shell. It
 * keeps working until the Graph archetype replaces it, so every phase of the
 * rewrite ships a game that runs.
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
