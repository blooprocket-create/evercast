import { useEffect, useRef } from 'react';

/**
 * What `aria-modal="true"` is supposed to mean, implemented.
 *
 * The attribute is a claim, not a mechanism: on its own it makes nothing inert,
 * traps no focus and closes on no key. `AppShell` already learned this once and
 * reached for `inert` on the boot gate; every other overlay in the game -
 * `Moment`, the surface host, the premise - still made the claim without
 * keeping it. So a keyboard player could Tab straight out of an "Erase this
 * run?" confirmation into the shelf behind it, activate something there, and
 * never find their way back to the dialog that was still on screen.
 *
 * This hook supplies the three behaviours the role implies:
 *
 *   - focus moves into the dialog when it opens, and back to whatever opened it
 *     when it closes (WCAG 2.4.3, Focus Order)
 *   - Tab and Shift+Tab cycle within it rather than walking out the back
 *     (WCAG 2.1.2, No Keyboard Trap, read the way round it is meant: focus may
 *     not leave a modal while the modal is what the player is being asked about)
 *   - Escape closes it, which is what every overlay in the game already
 *     promised by having a visible way out
 *
 * `onClose` is optional because not every moment has a way out that is not a
 * decision - a death screen has one button and means it.
 */
export function useDialog<T extends HTMLElement>(onClose?: () => void) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    // Restoring focus to whatever had it is the half that is easy to forget,
    // and the half a screen-reader user notices immediately.
    const previous = document.activeElement as HTMLElement | null;
    initialFocus(dialog)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Swallowed whether or not this dialog has a way out, so Escape over a
        // death screen cannot reach past it and close the surface underneath.
        event.stopPropagation();
        event.preventDefault();
        onClose?.();
        return;
      }
      if (event.key !== 'Tab') return;

      const targets = focusables(dialog);
      if (targets.length === 0) {
        // Nothing to move to, so the only correct move is not to move.
        event.preventDefault();
        return;
      }
      const first = targets[0];
      const last = targets[targets.length - 1];
      const active = document.activeElement;

      // Wrapping is handled here rather than left to the browser because the
      // browser's next stop is the shelf behind the scrim.
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    dialog.addEventListener('keydown', onKeyDown);
    return () => {
      dialog.removeEventListener('keydown', onKeyDown);
      // `isConnected` guards the case where the whole tree went away with the
      // dialog: focusing a detached node silently moves focus to the body.
      if (previous?.isConnected) previous.focus();
    };
  }, [onClose]);

  return ref;
}

/**
 * Where focus lands when the dialog opens.
 *
 * The first focusable is the right default and the wrong one for a
 * confirmation. `Moment` draws its primary action first, so on "Erase this
 * run?" the first focusable is `Erase everything` - and the player arrived by
 * pressing Enter. A held key that auto-repeats, or one more reflexive Enter,
 * and the run is gone with no undo. Opening a dialog must never put the
 * irreversible option under the key that opened it.
 *
 * So a dialog may nominate its own landing spot with `data-autofocus`, and the
 * destructive ones point it at the way out. The attribute rather than a ref
 * because it survives being passed through `Moment`'s action tuple without
 * every caller having to thread one.
 */
function initialFocus(root: HTMLElement): HTMLElement | undefined {
  const targets = focusables(root);
  return targets.find((element) => element.hasAttribute('data-autofocus')) ?? targets[0];
}

/**
 * Everything inside `root` that can take focus, in document order.
 *
 * `disabled` controls and anything hidden from assistive technology are left
 * out, because a trap that cycles through a disabled button reads as focus
 * disappearing.
 */
function focusables(root: HTMLElement): HTMLElement[] {
  const selector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');
  return [...root.querySelectorAll<HTMLElement>(selector)].filter(
    (element) => element.getAttribute('aria-hidden') !== 'true' && element.offsetParent !== null,
  );
}
