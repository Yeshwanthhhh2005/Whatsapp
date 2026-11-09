import { useEffect } from 'react';

/**
 * Close a popover when the user clicks outside any `[data-menu-root]` element
 * or presses Escape.
 *
 * Each popover keeps its own open state and calls this, rather than one global
 * listener trying to know about all of them.
 */
export function useDismiss(active: boolean, close: () => void): void {
  useEffect(() => {
    if (!active) return undefined;

    const onPointerDown = (event: MouseEvent) => {
      if (!(event.target as HTMLElement | null)?.closest('[data-menu-root]')) {
        close();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [active, close]);
}
