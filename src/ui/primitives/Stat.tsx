import styles from './Stat.module.css';

interface StatProps {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  /** One stat per dashboard may lead. Use it for the headline number. */
  emphasis?: boolean;
}

export function Stat({ label, value, detail, emphasis }: StatProps) {
  return (
    <div className={emphasis ? `${styles.stat} ${styles.emphasis}` : styles.stat}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>{value}</span>
      {detail !== undefined && <span className={styles.detail}>{detail}</span>}
    </div>
  );
}
