import { useEffect, useRef } from 'react';
import type { BootPhase } from '../../app/BootPhase';
import { Button } from '../primitives/Button';
import styles from './BootGate.module.css';

/**
 * The title screen, the loading screen and the first gesture, as one thing.
 *
 * It is shell chrome rather than an archetype on purpose. `ARCHETYPES` is a
 * closed set of five that `ui/architecture.test.ts` asserts, and a boot screen
 * is not a sixth kind of surface - it is the frame the surfaces arrive inside,
 * the same way the HUD and the shelf are.
 *
 * The button is doing three jobs at once, and the third is the one nobody sees:
 *
 *   1. It starts the game loop, so nothing ticks against a world that is not
 *      on screen yet.
 *   2. It is where "Continue" lives for a save and "Begin" for a new one.
 *   3. It is the gesture `AudioEngine.start` has been waiting for.
 *
 * That third job is why a gate earns its place in an idle game rather than
 * merely decorating it. Browsers refuse to open an AudioContext without a
 * gesture, and this game asks for none - the mage fights unattended, and a
 * player can watch a frontier fall without ever pressing anything. Before this
 * screen existed, a first session could run its whole length in silence.
 */
interface BootGateProps {
  phase: BootPhase;
  /** A save was picked up, so this is a welcome back rather than a hello. */
  resumed: boolean;
  onBegin: () => void;
}

export function BootGate({ phase, resumed, onBegin }: BootGateProps) {
  const action = useRef<HTMLButtonElement>(null);
  const preparing = phase === 'preparing';

  /**
   * Not `autoFocus`: that applies on mount, and on mount this button is
   * disabled and therefore unfocusable. The moment worth focusing is the one
   * where it becomes pressable, which is a re-render of the same element.
   */
  useEffect(() => {
    if (!preparing) action.current?.focus();
  }, [preparing]);

  if (phase === 'playing') return null;

  return (
    <div className={styles.gate} role="dialog" aria-modal="true" aria-label="Evercast">
      <div className={styles.plate}>
        <h1 className={styles.wordmark}>EVERCAST</h1>
        <p className={styles.premise}>
          {resumed ? 'The spell never stopped.' : 'One spell, cast without end.'}
        </p>

        <Button
          variant="primary"
          className={styles.action}
          onClick={onBegin}
          disabled={preparing}
          ref={action}
          // The label carries the wait rather than a second widget doing it.
          // A spinner beside a disabled button says the same thing twice.
          aria-busy={preparing}
        >
          {preparing ? 'Gathering the world' : resumed ? 'Continue' : 'Begin'}
        </Button>

        <p className={styles.note} aria-live="polite">
          {preparing
            ? 'Waking the woods…'
            : resumed
              ? 'It held the line while you were gone.'
              : 'Everything it kills makes it stronger.'}
        </p>
      </div>
    </div>
  );
}
