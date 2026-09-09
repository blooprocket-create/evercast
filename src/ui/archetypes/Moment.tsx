import { Button } from '../primitives/Button';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/names';
import styles from './Moment.module.css';

/**
 * Archetype 5 of 5, and the one worth policing hardest. Every system wants its
 * own celebration screen, and three years of that is thirty bespoke modals
 * nobody can keep consistent.
 *
 * The cap is structural rather than advisory: `cells` is a tuple type, so a
 * fourth cell will not compile. If a moment needs one, it is not a moment - it
 * is a surface, and it belongs in the rail.
 */
export interface MomentCell {
  label: string;
  value: React.ReactNode;
}

export type MomentCells = [MomentCell] | [MomentCell, MomentCell] | [MomentCell, MomentCell, MomentCell];

export interface MomentAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

interface MomentProps {
  tone: 'accent' | 'danger' | 'essence';
  icon: IconName;
  headline: string;
  consequence: string;
  cells?: MomentCells;
  primary: MomentAction;
  secondary?: MomentAction;
  hint?: React.ReactNode;
}

export function Moment({
  tone,
  icon,
  headline,
  consequence,
  cells,
  primary,
  secondary,
  hint,
}: MomentProps) {
  return (
    <div className={styles.scrim} role="dialog" aria-modal="true" aria-label={headline}>
      <div className={`${styles.card} ${styles[tone]}`}>
        <span className={styles.badge}>
          <Icon name={icon} size={24} />
        </span>
        <h2 className={styles.headline}>{headline}</h2>
        <p className={styles.consequence}>{consequence}</p>

        {cells && (
          <div className={styles.cells}>
            {cells.map((cell) => (
              <div className={styles.cell} key={cell.label}>
                <span className={styles.cellLabel}>{cell.label}</span>
                <span className={styles.cellValue}>{cell.value}</span>
              </div>
            ))}
          </div>
        )}

        <div className={styles.actions}>
          <Button variant="primary" onClick={primary.onClick} disabled={primary.disabled}>
            {primary.label}
          </Button>
          {secondary && (
            <Button onClick={secondary.onClick} disabled={secondary.disabled}>
              {secondary.label}
            </Button>
          )}
        </div>

        {hint && <p className={styles.hint}>{hint}</p>}
      </div>
    </div>
  );
}
