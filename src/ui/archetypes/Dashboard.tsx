import { scrollEdgeAttributes, useScrollEdges } from './useScrollEdges';
import styles from './Dashboard.module.css';

/**
 * Archetype 1 of 5. Stat cards in an auto-filling grid, plus optional
 * breakdown sections and a side rail. Surfaces supply data; the archetype owns
 * every layout and scroll decision.
 */
interface DashboardProps {
  /**
   * Optional, because a dashboard's subject does not always have numbers.
   * Automation is the first: four switches and the sentences explaining them,
   * with nothing to count. Rendering the grid anyway left an empty row's worth
   * of gap above the first panel.
   */
  stats?: React.ReactNode;
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
        {stats !== undefined && <div className={styles.stats}>{stats}</div>}
        {sections}
      </div>
      {aside && <div className={styles.aside}>{aside}</div>}
    </div>
  );
}
