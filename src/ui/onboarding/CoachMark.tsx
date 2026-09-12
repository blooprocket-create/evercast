import { useSnapshot } from '../state/snapshot';
import { coachMark } from './coachMarks';
import styles from './CoachMark.module.css';

/**
 * Draws whichever mark `coachMarks` says is live, or nothing at all - which is
 * what it says for most of a save's life, and should be.
 *
 * Pressing it opens the surface the mark is about. That is the difference
 * between a hint and an instruction: a player who is told Essence buys Spell
 * Points still has to find the Spell Tree, and making them hunt for it is how a
 * hint becomes a chore.
 */
export function CoachMark({ onOpen }: { onOpen: (destinationId: string) => void }) {
  const mark = coachMark(useSnapshot());
  if (!mark) return null;

  return (
    <button type="button" className={styles.mark} onClick={() => onOpen(mark.destinationId)}>
      <span className={styles.dot} aria-hidden="true" />
      {mark.text}
    </button>
  );
}
