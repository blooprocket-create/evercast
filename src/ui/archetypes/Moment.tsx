import { Button } from '../primitives/Button';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/names';
import { useDialog } from '../shell/useDialog';
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
  /**
   * What Escape does, when Escape does anything.
   *
   * A moment that only offers a decision - a death screen, a confirmation with
   * no cancel - deliberately passes nothing, and then Escape does nothing
   * either. Anywhere there is already a way out on screen, this is it, so the
   * keyboard has the same way out the mouse does.
   */
  onDismiss?: () => void;
  /**
   * Whether this moment is covering the game or *is* the screen.
   *
   * Both happen. `Moment` is archetype 5 of 5, so a destination whose whole
   * content is one decision - Rebirth - renders as one inside the surface host,
   * with a nav rail and a Back button beside it. That is not a dialog: calling
   * it one tells a screen reader the rest of the page is unavailable, and
   * trapping focus in it would make the rail genuinely unreachable, which is
   * the accessibility failure rather than the fix for one.
   *
   * So modal is the default, because an overlay is the common case and the
   * dangerous one to get wrong, and a surface says `modal={false}`.
   */
  modal?: boolean;
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
  onDismiss,
  modal = true,
}: MomentProps) {
  // `aria-modal` below is a claim about focus; this is what makes it true.
  const dialog = useDialog<HTMLDivElement>(modal ? (onDismiss ?? secondary?.onClick) : undefined);
  /*
   * A danger moment with a way out is a confirmation, and a confirmation opens
   * on its safe half. Danger with no secondary is a death screen: one button,
   * nothing to protect the player from, and it takes the focus because it is
   * the only thing there.
   */
  const safeActionTakesFocus = modal && tone === 'danger' && secondary !== undefined;

  return (
    <div
      ref={modal ? dialog : undefined}
      className={styles.scrim}
      role={modal ? 'dialog' : 'group'}
      aria-modal={modal ? 'true' : undefined}
      aria-label={headline}
    >
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

        {/*
          The primary action is drawn first and stays drawn first - it is the
          one being offered, and moving it would make every moment in the game
          read differently to serve one of them. What moves is the *focus*: a
          danger moment that offers a way out lands on the way out. See
          `initialFocus` in useDialog.ts for why that matters more than it
          sounds like it should.
        */}
        <div className={styles.actions}>
          <Button variant="primary" onClick={primary.onClick} disabled={primary.disabled}>
            {primary.label}
          </Button>
          {secondary && (
            <Button
              onClick={secondary.onClick}
              disabled={secondary.disabled}
              data-autofocus={safeActionTakesFocus ? '' : undefined}
            >
              {secondary.label}
            </Button>
          )}
        </div>

        {hint && <p className={styles.hint}>{hint}</p>}
      </div>
    </div>
  );
}
