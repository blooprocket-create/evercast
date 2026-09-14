import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/names';
import styles from './Toasts.module.css';

/**
 * The transient channel the interface did not have.
 *
 * Everything the game had to say was either a full-screen `Moment` or one line
 * of a log that the next event overwrites - and that log is not rendered below
 * 860px at all. So the things in between had nowhere to go: the mage falling,
 * a gear tier, a new zone. The audit's FEEL-1 asked for a defeat screen, but a
 * modal on every death is the wrong shape for a game whose loop *is* push
 * until you fail; this is the shape that fits.
 *
 * Deliberately small: a queue, a lifetime, and no decisions. Anything that
 * needs an answer from the player is a `Moment`.
 */
export type ToastTone = 'defeat' | 'reward' | 'neutral';

export interface Toast {
  /** Stable per occurrence, so a re-render cannot raise the same one twice. */
  id: string;
  tone: ToastTone;
  icon: IconName;
  title: string;
  detail?: string;
}

/** Long enough to read twice, short enough not to sit over the fight. */
const LIFETIME_MS = 6_000;

export function Toasts({ toasts, onExpire }: { toasts: readonly Toast[]; onExpire: (id: string) => void }) {
  const timers = useRef(new Map<string, number>());

  useEffect(() => {
    for (const toast of toasts) {
      if (timers.current.has(toast.id)) continue;
      const timer = window.setTimeout(() => {
        timers.current.delete(toast.id);
        onExpire(toast.id);
      }, LIFETIME_MS);
      timers.current.set(toast.id, timer);
    }
    // A toast dismissed by hand must not leave its timer running.
    const live = new Set(toasts.map((toast) => toast.id));
    for (const [id, timer] of timers.current) {
      if (live.has(id)) continue;
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, [toasts, onExpire]);

  useEffect(() => {
    const running = timers.current;
    return () => {
      for (const timer of running.values()) window.clearTimeout(timer);
      running.clear();
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    /*
     * `polite`, like the shelf log: an idle game produces events faster than
     * anyone can be interrupted, and a player moving through the spell tree
     * must not be cut off by a kill.
     */
    <div className={styles.stack} aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          className={`${styles.toast} ${styles[toast.tone]}`}
          onClick={() => onExpire(toast.id)}
        >
          <span className={styles.icon}>
            <Icon name={toast.icon} size={16} />
          </span>
          <span className={styles.text}>
            <span className={styles.title}>{toast.title}</span>
            {toast.detail !== undefined && <span className={styles.detail}>{toast.detail}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * The queue itself. Capped, because an offline catch-up can produce a hundred
 * of these in one frame and the newest are the ones worth showing.
 */
const MAX_VISIBLE = 3;

export function useToasts() {
  const [toasts, setToasts] = useState<readonly Toast[]>([]);

  /*
   * Stable, because both are effect dependencies in two places - the queue's
   * own timers and whatever raises a toast - and the shell re-renders at the
   * publish rate. A new function every frame would re-arm every timer in the
   * list several times a second.
   */
  const raise = useCallback(
    (toast: Toast) =>
      setToasts((current) =>
        current.some((existing) => existing.id === toast.id)
          ? current
          : [...current, toast].slice(-MAX_VISIBLE),
      ),
    [],
  );

  const expire = useCallback(
    (id: string) => setToasts((current) => current.filter((toast) => toast.id !== id)),
    [],
  );

  return { toasts, raise, expire };
}
