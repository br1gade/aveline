import { useRef, useState } from 'react';

import type { PageActions } from './page-status';

/** What a dialog opened from a page row needs from the page. */
export interface DialogContext {
  page: PageActions;
  onClose: () => void;
  /** Back to what opened the dialog, when nothing was done (`useDialogOpener`). */
  restoreFocus: (closing: Event) => void;
}

/** A refusal a dialog can show; a stale one reloads the page behind its words. */
interface DialogRefusal {
  isStale?: boolean | undefined;
}

/**
 * One press inside a dialog. It can't be dismissed while the request runs, so a refusal always has
 * somewhere to show, and a late answer can't close the next dialog. After an action the focus goes
 * to the page's status line; otherwise back to what opened the dialog.
 */
export function useDialogAction<Refusal extends DialogRefusal>(
  { page, onClose, restoreFocus }: DialogContext,
  refusalOf: (error: unknown) => Refusal,
) {
  const [isBusy, setIsBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const isDone = useRef(false);
  const onCloseAutoFocus = (closing: Event) =>
    isDone.current ? page.focusStatus(closing) : restoreFocus(closing);
  const onOpenChange = (isOpen: boolean) => {
    if (!isOpen && !isBusy) onClose();
  };
  /** `message` may be decided by what the action answered, as a function read once it has. */
  const run = async (action: () => Promise<void>, message: string | (() => string)) => {
    setRefusal(null);
    setIsBusy(true);
    try {
      await action();
      await page.done(typeof message === 'function' ? message() : message);
      isDone.current = true;
      onClose();
    } catch (error) {
      // Free first: an error that isn't the API's is thrown on as a bug, and must not leave the
      // dialog stuck busy, unable to be closed.
      setIsBusy(false);
      const found = refusalOf(error);
      setRefusal(found);
      if (found.isStale) page.reload();
    }
  };
  return { isBusy, refusal, run, onCloseAutoFocus, onOpenChange };
}
