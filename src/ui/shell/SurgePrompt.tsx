import { useEffect } from 'react';
import { useCommand } from '../state/CommandContext';
import { useSnapshotSelector } from '../state/snapshot';
import styles from './SurgePrompt.module.css';

/**
 * Space, for as long as a Surge is in the air.
 *
 * The one time-critical action in the game deserves a key, and a global one is
 * only defensible because it is bound for the two seconds it means something
 * and unbound the rest of the time. Guarded against the obvious collisions: a
 * modifier means the player is doing something else, and a control that
 * already answers Space - or any text field - answers it first.
 */
function useCounterKey(armed: boolean, onCounter: () => void): void {
  useEffect(() => {
    if (!armed) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== ' ' && event.key !== 'Spacebar') return;
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select, button, [contenteditable]')) return;
      event.preventDefault();
      onCounter();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [armed, onCounter]);
}

export interface SurgePromptViewProps {
  /** Absent when no Surge is in the air, which is nearly all of the time. */
  surge: { enemyName: string; secondsRemaining: number; windowSeconds: number } | null;
  charges: number;
  maxCharges: number;
  /** Progress toward the charge being earned back, 0 to 1. */
  rechargeFraction: number;
  onCounter: () => void;
}

/**
 * The only thing in Evercast that asks the player to be present.
 *
 * Drawn over the middle of the diorama rather than in the chrome at either
 * edge, because for the couple of seconds it exists the fight is what the
 * player is looking at - and because both edges are already spoken for at one
 * breakpoint or another (the place block above, the enemy card below on a
 * phone).
 *
 * Pure and prop-driven so it can be rendered and asserted without a store
 * behind it; `SurgePrompt` is the two lines that connect it to one.
 */
export function SurgePromptView({
  surge,
  charges,
  maxCharges,
  rechargeFraction,
  onCounter,
}: SurgePromptViewProps) {
  if (!surge) return null;
  const left = Math.max(0, Math.min(1, surge.secondsRemaining / surge.windowSeconds));
  const spent = charges < 1;

  return (
    <div className={styles.prompt}>
      {/*
        Announced once and then left alone. The text is deliberately constant
        for the life of the Surge - a live region re-announces whenever its
        contents change, and a countdown would read the window out loud twenty
        times over while it closed.
      */}
      <span className={styles.announcer} role="alert">
        {surge.enemyName} gathers a Surge. Counterspell to break it.
      </span>

      <button
        type="button"
        className={styles.button}
        onClick={onCounter}
        disabled={spent}
        aria-label={`Counterspell. ${charges} of ${maxCharges} charges.`}
      >
        <span className={styles.title}>Counterspell</span>
        <span className={styles.subtitle}>
          {spent ? 'No charge' : `${surge.enemyName} is gathering a Surge`}
        </span>
        <span className={styles.track} aria-hidden="true">
          <span className={styles.fill} style={{ transform: `scaleX(${left})` }} />
        </span>
      </button>

      <span className={styles.charges} aria-hidden="true">
        {Array.from({ length: maxCharges }, (_, index) => (
          <span
            key={index}
            className={index < charges ? `${styles.pip} ${styles.pipFull}` : styles.pip}
            /*
             * The first empty pip carries the one being earned back, so a spent
             * charge reads as returning rather than simply gone.
             */
            style={
              index === charges
                ? ({ '--earned': `${rechargeFraction * 100}%` } as React.CSSProperties)
                : undefined
            }
          />
        ))}
      </span>
    </div>
  );
}

export function SurgePrompt() {
  const run = useCommand();
  /*
   * Scalars rather than the `surge` object: the snapshot is a brand-new graph
   * on every publish, so selecting the object could never memoize by identity
   * and the prompt would re-render on every frame of the whole game rather
   * than on the frames a Surge is running. See `useSnapshot`.
   */
  const live = useSnapshotSelector((s) => s.surge !== null);
  const enemyName = useSnapshotSelector((s) => s.surge?.enemyName ?? '');
  const secondsRemaining = useSnapshotSelector((s) => s.surge?.secondsRemaining ?? 0);
  const windowSeconds = useSnapshotSelector((s) => s.surge?.windowSeconds ?? 1);
  const charges = useSnapshotSelector((s) => s.counterspell.charges);
  const maxCharges = useSnapshotSelector((s) => s.counterspell.maxCharges);
  const rechargeFraction = useSnapshotSelector((s) => s.counterspell.rechargeFraction);
  const ready = useSnapshotSelector((s) => s.counterspell.ready);

  useCounterKey(ready, () => run({ type: 'counterspell' }));

  return (
    <SurgePromptView
      surge={live ? { enemyName, secondsRemaining, windowSeconds } : null}
      charges={charges}
      maxCharges={maxCharges}
      rechargeFraction={rechargeFraction}
      onCounter={() => run({ type: 'counterspell' })}
    />
  );
}
