import { scrollEdgeAttributes, useScrollEdges } from './useScrollEdges';
import styles from './Detail.module.css';

/**
 * Archetype 4 of 5. A ledger on the left, the selected thing on the right.
 * The archetype owns both scroll containers so a surface cannot invent a
 * second scrolling axis.
 */
interface DetailProps {
  list: React.ReactNode;
  children: React.ReactNode;
  /**
   * The one thing this surface is for doing, kept out of the scroll.
   *
   * Handed to the archetype rather than left in the flow because the pane
   * ordered eyebrow, name, description, facts and *then* the action - so on
   * every phone and every landscape phone the action fell past the fold, with
   * no scrollbar, no fade and no half-visible row to say the pane moved. Gear
   * lost Level up, Companions lost Ascend, Party lost its whole roster picker,
   * Settings lost half its fields. The last thing on screen was the word
   * "BUY", itself clipped by the shelf.
   *
   * It is a sibling of the scroll container rather than a sticky child of it.
   * Sticky was the first attempt and it read badly: the pane's own fade ran
   * over the bottom of the action, and text scrolling under a gradient that
   * starts at transparent surfaced through the top of it. Out here the
   * scroller fades at its own edge, the action never moves, and neither has to
   * know about the other.
   */
  action?: React.ReactNode;
}

export function Detail({ list, children, action }: DetailProps) {
  const pane = useScrollEdges();

  return (
    <div className={styles.detail}>
      <div className={styles.list}>{list}</div>
      <div className={styles.pane}>
        <div className={styles.paneScroll} ref={pane.ref} {...scrollEdgeAttributes(pane)}>
          <div className={styles.paneContent} ref={pane.contentRef}>
            {children}
          </div>
        </div>
        {action !== undefined && <div className={styles.action}>{action}</div>}
      </div>
    </div>
  );
}
