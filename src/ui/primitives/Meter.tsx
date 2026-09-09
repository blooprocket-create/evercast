import styles from './Meter.module.css';

type MeterTone = 'you' | 'foe' | 'accent';

interface MeterProps {
  label?: string;
  readout?: React.ReactNode;
  /** 0 to 100. */
  percent: number;
  tone?: MeterTone;
  slim?: boolean;
}

export function Meter({ label, readout, percent, tone = 'accent', slim }: MeterProps) {
  const width = Math.max(0, Math.min(100, percent));
  return (
    <div className={slim ? `${styles.meter} ${styles.slim}` : styles.meter}>
      {(label !== undefined || readout !== undefined) && (
        <div className={styles.head}>
          {label !== undefined && <span className={styles.label}>{label}</span>}
          {readout !== undefined && <span className={styles.readout}>{readout}</span>}
        </div>
      )}
      <div
        className={styles.track}
        role="meter"
        aria-valuenow={Math.round(width)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div className={`${styles.fill} ${styles[tone]}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}
