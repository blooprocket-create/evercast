import { Field, Toggle } from '../primitives/Field';
import { Panel } from '../primitives/Panel';
import type { AutomationKey } from '../../engine/automation/AutomationSystem';
import { useCommand } from '../state/CommandContext';
import { useSnapshotSelector } from '../state/snapshot';
import styles from './AutomationSurface.module.css';

/**
 * What the player has handed over.
 *
 * Every row says what it spends and why giving it away costs nothing, because
 * the honest answer in each case is that the player was only being asked to
 * perform a move that had one right answer. The rows that would *not* be
 * honest are the ones that are missing: activating a spell node, filling a
 * party slot, choosing when to Rebirth. Those are the game.
 */
const ROWS: { key: AutomationKey; label: string; hint: string }[] = [
  {
    key: 'gear',
    label: 'Spend Gold on gear',
    hint: 'Buys whichever level is worth the most per Gold, alternating damage and health. This is the same rule the balance harness plays by.',
  },
  {
    key: 'spellPoints',
    label: 'Spend Essence on Spell Points',
    hint: 'Buys points, never spends them. Which nodes you light is yours and stays yours.',
  },
  {
    key: 'ascend',
    label: 'Spend shards on stars',
    hint: 'Shards have one use, and a companion you already own is the only place they go.',
  },
  {
    key: 'summon',
    label: 'Spend Starlight on summons',
    hint: 'Ten at a time, and without the reveal. Off by default because opening them is the good part - turn it on when you would rather the Starlight were simply spent.',
  },
];

export function AutomationSurface() {
  const run = useCommand();
  const automation = useSnapshotSelector(
    (s) => ROWS.map((row) => s.automation[row.key]).join(','),
  );
  const enabled = automation.split(',').map((value) => value === 'true');

  return (
    <div className={styles.pane}>
      <div className={styles.heading}>
        <h2 className={styles.title}>Automation</h2>
        <p className={styles.blurb}>
          The Evercast fights on its own. These are the chores around it — the ones where you were
          only ever pressing the one button that was correct.
        </p>
      </div>

      <Panel title="Hand over">
        {ROWS.map((row, index) => (
          <Field key={row.key} label={row.label} hint={row.hint}>
            <Toggle
              checked={enabled[index] ?? false}
              label={row.label}
              onChange={(next) => run({ type: 'set_automation', key: row.key, enabled: next })}
            />
          </Field>
        ))}
      </Panel>

      {/*
        Said out loud rather than left to be noticed. A player who finds a
        setting they did not expect should be able to tell immediately whether
        the game has been playing itself behind their back.
      */}
      <Panel title="What stays yours">
        <p className={styles.blurb}>
          The spell tree, your party, and when to Rebirth. Nothing here will ever light a node,
          fill a slot or spend your run — a game that picked the tree for you would have automated
          away the only thing Evercast is about.
        </p>
        <p className={styles.note}>
          Purchases are made on the road between encounters, so Gold banked mid-fight is spent a
          few seconds later rather than the instant it lands.
        </p>
      </Panel>
    </div>
  );
}
