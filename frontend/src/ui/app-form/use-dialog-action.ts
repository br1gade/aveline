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
  /**
   * `message` may be decided by what the action answered, as a function read once it has. `null`
   * means the action has sent the browser elsewhere, to a bank's page: nothing is said, nothing is
   * read again and the dialog stays busy, as reading the page again while the browser leaves is
   * what WebKit cancels into the error page (audit F-30).
   */
  const run = async (action: () => Promise<void>, message: string | (() => string | null)) => {
    setRefusal(null);
    setIsBusy(true);
    try {
      await action();
      const said = typeof message === 'function' ? message() : message;
      if (said === null) return;
      await page.done(said);
      isDone.current = true;
      onClose();
    } catch (error) {
      await settle(error);
    }
  };
  /**
   * A refusal stays on the dialog. A stale one reads the page again behind it, and the press stays
   * busy until it has, so pressing again goes with what was just read, not what was refused (audit
   * 20 Nov, A2-07). An error that isn't the API's is thrown on as a bug, and must not leave the
   * dialog stuck busy, unable to be closed.
   */
  const settle = async (error: unknown) => {
    try {
      const found = refusalOf(error);
      setRefusal(found);
      if (found.isStale) await page.reloadAndWait();
    } finally {
      setIsBusy(false);
    }
  };
  return { isBusy, refusal, run, onCloseAutoFocus, onOpenChange };
}
