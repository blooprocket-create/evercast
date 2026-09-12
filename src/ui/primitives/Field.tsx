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

/**
 * The keys that move a range input. `onCommit` fires on the way up from one of
 * these and on the end of a drag - not on every keyup, or tabbing out of a
 * volume slider would play a sound at the player.
 */
const ADJUST_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  /**
   * Called once the player finishes setting the value, rather than on every
   * step through it. A volume slider auditions itself here: doing it from
   * `onChange` fires up to twenty times across one drag.
   */
  onCommit?: () => void;
  /** Rendered to the right of the track. */
  format?: (value: number) => string;
  disabled?: boolean;
  label: string;
}

export function Slider({ value, onChange, onCommit, format, disabled, label }: SliderProps) {
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
        onPointerUp={onCommit}
        onKeyUp={(event) => {
          if (ADJUST_KEYS.has(event.key)) onCommit?.();
        }}
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
