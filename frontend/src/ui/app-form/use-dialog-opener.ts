import { useCallback, useRef } from 'react';

/**
 * Where the focus goes back to when a dialog with no trigger of its own closes. Radix returns it to
 * its trigger, and these dialogs are opened from a row, so without this it falls to the page's body.
 */
export function useDialogOpener() {
  const openerRef = useRef<HTMLElement | null>(null);
  const remember = useCallback((opener: HTMLElement) => {
    openerRef.current = opener;
  }, []);
  const restoreFocus = useCallback((closing: Event) => {
    closing.preventDefault();
    if (openerRef.current?.isConnected) openerRef.current.focus();
  }, []);
  return { remember, restoreFocus };
}
