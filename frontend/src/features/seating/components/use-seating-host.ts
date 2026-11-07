import { useCallback, useEffect, useRef, useState } from 'react';
import { useRevalidator } from 'react-router';

import type { HouseholdToSeat, PersonToSeat } from '../candidates';
import type { SeatingRefusal } from '../refusals';
import type { SeatedGuest, SeatingTable } from '../types';

/** The one dialog the page shows at a time. */
export type SeatingDialog =
  | { kind: 'addTable' }
  | { kind: 'addTables' }
  | { kind: 'editTable'; table: SeatingTable }
  | { kind: 'removeTable'; table: SeatingTable }
  | { kind: 'seat'; household: HouseholdToSeat; guests: PersonToSeat[] }
  | { kind: 'move'; table: SeatingTable; guest: SeatedGuest }
  | { kind: 'chair'; table: SeatingTable; guest: SeatedGuest };

/** What a panel or a dialog needs from the page. */
export interface SeatingHost {
  eventId: string;
  open: (dialog: SeatingDialog, opener: HTMLElement) => void;
  /** After a dialog's write: reload the page, close it, and say what happened. `null`: nothing sent. */
  saved: (message: string | null) => Promise<void>;
  /** After a write made in place: reload the page, then say what happened, with the focus. */
  announce: (message: string) => Promise<void>;
  /** The page is out of date (a 404, a full table): reload it behind the message. */
  reload: () => void;
  close: () => void;
  /** Radix's `onCloseAutoFocus`: back to the button that opened it, or to the status line. */
  restoreFocus: (event: Event) => void;
  /** A refusal of an action taken on the page itself, not in a dialog. */
  refuse: (refusal: SeatingRefusal | null) => void;
}

interface Done {
  message: string;
  /** The page's data as it was when the write was sent. */
  before: unknown;
  /** Made in place, so the status line takes the focus; a dialog gives it back to its opener. */
  isInPlace: boolean;
}

/**
 * The seating page's dialogs, its status line and the refusal of an action taken in place, on the
 * guest list's pattern (`use-list-dialogs.ts`): every write reloads the page, and the dialog closes
 * in the render that shows the reloaded data, which React Router applies as a transition, so the
 * status line never speaks beside the old tables and the focus finds what is still there.
 */
export function useSeatingHost(eventId: string, data: unknown) {
  const { revalidate } = useRevalidator();
  const [dialog, setDialog] = useState<SeatingDialog | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [refusal, setRefusal] = useState<SeatingRefusal | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const isDone = done !== null && data !== done.before;
  const status = isDone ? done.message : '';
  const isInPlace = isDone && done.isInPlace;
  useEffect(() => {
    if (status && isInPlace) statusRef.current?.focus();
  }, [status, isInPlace]);

  const open = useCallback((next: SeatingDialog, opener: HTMLElement) => {
    openerRef.current = opener;
    setDone(null);
    setRefusal(null);
    setDialog(next);
  }, []);
  const saved = useCallback(
    async (message: string | null) => {
      if (!message) return setDialog(null);
      await revalidate();
      setDone({ message, before: data, isInPlace: false });
    },
    [revalidate, data],
  );
  const announce = useCallback(
    async (message: string) => {
      await revalidate();
      setDone({ message, before: data, isInPlace: true });
    },
    [revalidate, data],
  );
  const restoreFocus = useCallback((event: Event) => {
    event.preventDefault();
    const opener = openerRef.current;
    if (opener?.isConnected) opener.focus();
    else statusRef.current?.focus();
  }, []);
  const host: SeatingHost = {
    eventId,
    open,
    saved,
    announce,
    reload: () => void revalidate(),
    close: () => setDialog(null),
    restoreFocus,
    refuse: setRefusal,
  };
  return { host, dialog: isDone ? null : dialog, status, statusRef, refusal };
}
