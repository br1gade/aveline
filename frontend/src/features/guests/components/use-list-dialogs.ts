import { useCallback, useRef, useState } from 'react';
import { useRevalidator } from 'react-router';

import type { Household } from '../types';
import type { DialogTarget } from './dialog-target';

/** What a dialog needs from the list that hosts it. */
export interface DialogHostActions {
  /** After a write: reload the list, close, and say what happened. `null` when nothing was sent. */
  saved: (message: string | null) => Promise<void>;
  /** The list on screen is out of date (a 404, a move made meanwhile): reload it behind the dialog. */
  reload: () => void;
  close: () => void;
  /** Radix's `onCloseAutoFocus`: back to the button that opened the dialog, or the status line. */
  restoreFocus: (event: Event) => void;
}

/** A write that went through, waiting for the reloaded list to reach the screen. */
interface Done {
  message: string;
  /** The list as it was when the write was sent. */
  before: readonly Household[];
}

/**
 * The guest list's one dialog at a time, and the status line under the toolbar.
 *
 * Every write reloads the list: the server's answer is the truth (an email is stored lower-cased),
 * and a write's own response, which carries the guest's token (FR-29), is never read. The dialog
 * closes in the same render that shows the reloaded list, which React Router applies as a
 * transition, so that the focus can go back to the button that opened it only if that is still
 * there. After a move or a removal it is not, and the focus goes to the status line instead.
 */
export function useListDialogs(households: readonly Household[]) {
  const { revalidate } = useRevalidator();
  const [target, setTarget] = useState<DialogTarget | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);

  const isDone = done !== null && households !== done.before;

  const open = useCallback((next: DialogTarget, opener: HTMLElement) => {
    openerRef.current = opener;
    setDone(null);
    setTarget(next);
  }, []);
  const close = useCallback(() => setTarget(null), []);
  const saved = useCallback(
    async (message: string | null) => {
      if (!message) return setTarget(null);
      await revalidate();
      setDone({ message, before: households });
    },
    [revalidate, households],
  );
  const reload = useCallback(() => void revalidate(), [revalidate]);
  // Radix puts the focus back on its own trigger, which these dialogs, opened from a row, lack.
  const restoreFocus = useCallback((event: Event) => {
    event.preventDefault();
    const opener = openerRef.current;
    if (opener?.isConnected) opener.focus();
    else statusRef.current?.focus();
  }, []);

  const host: DialogHostActions = { saved, reload, close, restoreFocus };
  return {
    target: isDone ? null : target,
    open,
    host,
    status: isDone ? done.message : '',
    statusRef,
  };
}
