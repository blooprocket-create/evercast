import styles from './Field.module.css';

/**
 * A labelled row with a control on the right. Settings are made of these, and
 * keeping them one shape is what stops a settings screen turning into a pile of
 * bespoke layouts.
 */
interface FieldProps {
  label: string;
  hint?: React.ReactNode;
  disabled?: boolean;
  children: React.ReactNode;
}

export function Field({ label, hint, disabled, children }: FieldProps) {
  return (
    <div className={disabled ? `${styles.field} ${styles.disabled}` : styles.field}>
      <span className={styles.text}>
        <span className={styles.label}>{label}</span>
        {hint !== undefined && <span className={styles.hint}>{hint}</span>}
      </span>
      <span className={styles.control}>{children}</span>
    </div>
  );
}

interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  /** Rendered to the right of the track. */
  format?: (value: number) => string;
  disabled?: boolean;
  label: string;
}

export function Slider({ value, onChange, format, disabled, label }: SliderProps) {
  return (
    <>
      <input
        className={styles.slider}
        type="range"
        min={0}
        max={100}
        step={5}
        value={Math.round(value * 100)}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
      />
      <span className={styles.readout}>
        {format ? format(value) : `${Math.round(value * 100)}%`}
      </span>
    </>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={checked ? `${styles.toggle} ${styles.toggleOn}` : styles.toggle}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.knob} />
    </button>
  );
}

export function Choice<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { id: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <span className={styles.choice} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={option.id === value}
          className={option.id === value ? `${styles.option} ${styles.optionOn}` : styles.option}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </span>
  );
}
