import styles from './Detail.module.css';

/**
 * Archetype 4 of 5. A ledger on the left, the selected thing on the right.
 * The archetype owns both scroll containers so a surface cannot invent a
 * second scrolling axis.
 */
interface DetailProps {
  list: React.ReactNode;
  children: React.ReactNode;
}

export function Detail({ list, children }: DetailProps) {
  return (
    <div className={styles.detail}>
      <div className={styles.list}>{list}</div>
      <div className={styles.pane}>{children}</div>
    </div>
  );
}
