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
  /**
   * The scene has a frame of the title void on screen, so the curtain can lift
   * and let the sigil through. False whenever there is no renderer at all, which
   * is why a machine with no WebGL simply gets the gate as it has always been.
   */
  lit: boolean;
  onBegin: () => void;
}

export function BootGate({ phase, resumed, lit, onBegin }: BootGateProps) {
  const action = useRef<HTMLButtonElement>(null);
  const preparing = phase === 'preparing';
  /*
   * The button has been pressed and the loop is paying the absence down. It is
   * one synchronous call of up to ten minutes of simulation, so this is a
   * frozen frame rather than an animated one - which is exactly why it has to
   * be a frame that says something. Before this the gate was already gone and
   * the first seconds of a session were an interface that did not answer.
   */
  const settling = phase === 'settling';
  const busy = preparing || settling;

  /**
   * Not `autoFocus`: that applies on mount, and on mount this button is
   * disabled and therefore unfocusable. The moment worth focusing is the one
   * where it becomes pressable, which is a re-render of the same element.
   */
  useEffect(() => {
    if (!busy) action.current?.focus();
  }, [busy]);

  if (phase === 'playing') return null;

  // Never while preparing: the curtain cannot lift before the gate is ready,
  // whatever the scene reports.
  const showing = lit && !preparing;

  return (
    <div
      className={showing ? `${styles.gate} ${styles.lit}` : styles.gate}
      role="dialog"
      aria-modal="true"
      aria-label="Evercast"
    >
      <div className={styles.plate}>
        <h1 className={styles.wordmark}>EVERCAST</h1>
        <p className={styles.premise}>
          {resumed ? 'The spell never stopped.' : 'One spell, cast without end.'}
        </p>

        <Button
          variant="primary"
          className={styles.action}
          onClick={onBegin}
          disabled={busy}
          ref={action}
          // The label carries the wait rather than a second widget doing it.
          // A spinner beside a disabled button says the same thing twice.
          aria-busy={busy}
        >
          {preparing
            ? 'Gathering the world'
            : settling
              ? 'Catching up'
              : resumed
                ? 'Continue'
                : 'Begin'}
        </Button>

        <p className={styles.note} aria-live="polite">
          {preparing
            ? 'Waking the woods…'
            : settling
              ? 'Working through the time you were away…'
              : resumed
                ? 'It held the line while you were gone.'
                : 'Everything it kills makes it stronger.'}
        </p>
      </div>
    </div>
  );
}
