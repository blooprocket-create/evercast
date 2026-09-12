import { useEffect } from 'react';

/**
 * Escape, bound for as long as the component is mounted.
 *
 * Separate from `useDialog` because the two answer different needs: a modal
 * has to trap focus and give it back, while a full-screen surface is simply
 * something the player is standing in and should be able to step out of. The
 * surface host is not a dialog and should not claim to be one - it just owes
 * the keyboard the same way out its Back button gives the mouse.
 *
 * Bound on `window` rather than on an element, because focus may legitimately
 * be anywhere inside a surface - a slider, a spell-tree node, nothing at all.
 */
export function useEscape(onEscape: () => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // `defaultPrevented` lets anything nearer the player - a dialog opened on
      // top of a surface - answer first and stop this closing the surface too.
      if (event.key === 'Escape' && !event.defaultPrevented) onEscape();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onEscape]);
}
