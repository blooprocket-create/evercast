import { Moment } from '../archetypes/Moment';
import { NumberCell } from '../format/NumberCell';
import { useCommand } from '../state/CommandContext';
import { useSnapshotSelector } from '../state/snapshot';

/**
 * The first interface RebirthSystem has ever had. It is implemented and tested
 * in the engine, and the command has existed unused this whole time - all it
 * needed was a registry entry and a struct.
 */
export function RebirthSurface() {
  const run = useCommand();
  const gain = useSnapshotSelector((s) => s.rebirthKnowledgeGain.display);
  const knowledge = useSnapshotSelector((s) => s.knowledge.display);
  const rebirths = useSnapshotSelector((s) => s.rebirths);
  const best = useSnapshotSelector((s) => s.highestStageEver);
  const canRebirth = useSnapshotSelector((s) => s.canRebirth);

  return (
    <Moment
      tone="essence"
      icon="rebirth"
      headline="Unmake the spell"
      consequence="Everything resets to Frontier 1. What you learned about the Evercast does not, and your gear keeps the power it has already earned."
      cells={[
        { label: 'Knowledge', value: <NumberCell value={gain} prefix="+" /> },
        { label: 'Banked', value: <NumberCell value={knowledge} /> },
        { label: 'Rebirths', value: <NumberCell value={String(rebirths)} /> },
      ]}
      primary={{
        label: canRebirth ? 'Rebirth' : 'Not yet possible',
        disabled: !canRebirth,
        onClick: () => run({ type: 'rebirth' }),
      }}
      hint={`Your deepest run reached Frontier ${best}. Going further before rebirthing yields more.`}
    />
  );
}
