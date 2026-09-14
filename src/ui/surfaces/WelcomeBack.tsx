import type { OfflineSummary } from '../../engine/offline/OfflineProgressor';
import { Moment } from '../archetypes/Moment';
import { formatAwayTime } from '../format/awayTime';
import { NumberCell } from '../format/NumberCell';

/**
 * Coming back from away used to be a one-line banner that could never clear.
 * It is a moment: the same component the defeat and rebirth screens use.
 */
export function WelcomeBack({
  summary,
  onDismiss,
}: {
  summary: OfflineSummary;
  onDismiss: () => void;
}) {
  const away = formatAwayTime(summary.secondsApplied);

  return (
    <Moment
      tone="accent"
      icon="rebirth"
      headline="The spell kept casting"
      consequence={`You were away ${away}. The Evercast held the line without you.`}
      cells={[
        { label: 'Gold', value: <NumberCell value={summary.goldGained} prefix="+" /> },
        { label: 'Essence', value: <NumberCell value={summary.essenceGained} prefix="+" /> },
        {
          label: 'Frontier',
          value: `${summary.stageBefore} to ${summary.stageAfter}`,
        },
      ]}
      primary={{ label: 'Take it all', onClick: onDismiss }}
      onDismiss={onDismiss}
      hint={`${summary.kills.toLocaleString('en-US')} enemies felled while you were gone.`}
    />
  );
}
