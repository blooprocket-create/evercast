import { scrollEdgeAttributes, useScrollEdges } from './useScrollEdges';
import styles from './Dashboard.module.css';

/**
 * Archetype 1 of 5. Stat cards in an auto-filling grid, plus optional
 * breakdown sections and a side rail. Surfaces supply data; the archetype owns
 * every layout and scroll decision.
 */
interface DashboardProps {
  stats: React.ReactNode;
  sections?: React.ReactNode;
  aside?: React.ReactNode;
}

export function Dashboard({ stats, sections, aside }: DashboardProps) {
  const edges = useScrollEdges();

  return (
    <div
      ref={edges.ref}
      className={aside ? `${styles.dashboard} ${styles.withAside}` : styles.dashboard}
      {...scrollEdgeAttributes(edges)}
    >
      <div className={styles.main}>
        <div className={styles.stats}>{stats}</div>
        {sections}
      </div>
      {aside && <div className={styles.aside}>{aside}</div>}
    </div>
  );
}
