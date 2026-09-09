import styles from './Panel.module.css';

interface PanelProps {
  title: string;
  note?: React.ReactNode;
  children: React.ReactNode;
}

export function Panel({ title, note, children }: PanelProps) {
  return (
    <section className={styles.panel}>
      <header className={styles.heading}>
        <h3 className={styles.title}>{title}</h3>
        {note !== undefined && <span className={styles.note}>{note}</span>}
      </header>
      {children}
    </section>
  );
}
