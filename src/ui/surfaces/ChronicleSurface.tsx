import { useMemo } from 'react';
import { CHRONICLE_DEPTH } from '../../engine/events/Chronicle';
import { Ledger } from '../archetypes/Ledger';
import { formatRunClock } from '../format/runClock';
import { useSnapshotSelector } from '../state/snapshot';
import styles from './ChronicleSurface.module.css';

/**
 * The scrollback the shelf log never had.
 *
 * The shelf shows the last line or three, because that is what fits beside the
 * vitals; everything the player missed while a surface was open, while the
 * game was catching up on an absence, or simply while they were looking
 * somewhere else, is here. The engine decides what earns a line - see
 * `logWeight` - so this surface is a list and a clock and nothing else.
 */
export function ChronicleSurface() {
  const chronicle = useSnapshotSelector((s) => s.chronicle);
  // Newest first: a log is opened to find out what just happened, and the
  // engine keeps it in the order it happened in.
  const lines = useMemo(() => chronicle.slice().reverse(), [chronicle]);

  return (
    <Ledger
      items={lines}
      rowKey={(line) => String(line.seq)}
      header={
        <>
          <span className={styles.eyebrow}>This session</span>
          <span className={styles.count}>
            {lines.length === CHRONICLE_DEPTH
              ? `Last ${CHRONICLE_DEPTH} entries`
              : `${lines.length} ${lines.length === 1 ? 'entry' : 'entries'}`}
          </span>
        </>
      }
      empty="Nothing written down yet. The chronicle keeps what you chose and what happened to you - defeats, purchases, evolutions, summons - and leaves the fight itself to the diorama."
      renderRow={(line) => (
        <div className={styles.row}>
          <span className={styles.at}>{formatRunClock(line.at)}</span>
          <span className={styles.text}>{line.text}</span>
        </div>
      )}
    />
  );
}
