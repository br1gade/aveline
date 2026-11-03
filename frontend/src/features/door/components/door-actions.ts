import type { Dispatch } from 'react';

import { browserSession } from '@/api/session';
import type { Guest } from '@/features/guests';

import { admitTicket, checkIn, undoCheckIn } from '../api';
import { CODE_RUNNING, type DoorEvent } from '../arrival';
import { isListStale, refusalOf, type DoorRefusal } from '../refusals';

export interface DoorActions {
  checkIn: (guest: Guest) => Promise<void>;
  undo: (guest: Guest) => Promise<void>;
  /** Whether the field should be emptied: the code was answered and is done with. */
  admit: (code: string) => Promise<boolean>;
  codeEdited: () => void;
  dismiss: () => void;
}

interface DoorActionsContext {
  eventId: string;
  dispatch: Dispatch<DoorEvent>;
  guestOf: (guestId: string) => Guest | undefined;
  reloadGuests: () => void;
  refreshAgreements: () => void;
  refreshCounts: () => void;
}

/** A typo stays to be fixed, and a press that got no answer to be pressed again. */
function keepsCode(refusal: DoorRefusal): boolean {
  return (
    refusal.kind === 'noAnswer' ||
    refusal.kind === 'notRecognised' ||
    refusal.kind === 'rateLimited'
  );
}

/**
 * The door's writes. Nothing is shown as done before the server answers, and a refusal that shows
 * the page out of date reads again only what it needs.
 */
export function doorActions(context: DoorActionsContext): DoorActions {
  const { eventId, dispatch, guestOf, reloadGuests, refreshAgreements, refreshCounts } = context;
  const followUp = (refusal: DoorRefusal) => {
    if (isListStale(refusal)) reloadGuests();
    if (refusal.kind === 'mustAgree') refreshAgreements();
    if (refusal.kind === 'alreadyHere' || refusal.kind === 'ticketUsed') refreshCounts();
  };
  return {
    checkIn: async (guest) => {
      dispatch({ type: 'sent', running: guest.id });
      try {
        const answer = await checkIn(browserSession().api, eventId, guest.id);
        dispatch({ type: 'checkedIn', guest, answer });
        refreshCounts();
      } catch (error) {
        const refusal = refusalOf(error, 'checkIn');
        dispatch({ type: 'checkInRefused', guest, refusal });
        followUp(refusal);
      }
    },
    undo: async (guest) => {
      dispatch({ type: 'sent', running: guest.id });
      try {
        await undoCheckIn(browserSession().api, eventId, guest.id);
        dispatch({ type: 'undone', guest });
        refreshCounts();
      } catch (error) {
        const refusal = refusalOf(error, 'undo');
        dispatch({ type: 'undoRefused', guest, refusal });
        followUp(refusal);
      }
    },
    admit: async (code) => {
      dispatch({ type: 'sent', running: CODE_RUNNING });
      try {
        const answer = await admitTicket(browserSession().api, eventId, code);
        const guest = answer.guestId === null ? undefined : guestOf(answer.guestId);
        dispatch({ type: 'admitted', answer, guest });
        if (answer.guestId !== null && !guest) reloadGuests();
        refreshCounts();
        return true;
      } catch (error) {
        const refusal = refusalOf(error, 'admit');
        const nameOf = (guestId: string) => guestOf(guestId)?.name ?? null;
        dispatch({ type: 'admitRefused', refusal, nameOf });
        followUp(refusal);
        return !keepsCode(refusal);
      }
    },
    codeEdited: () => dispatch({ type: 'codeEdited' }),
    dismiss: () => dispatch({ type: 'dismissed' }),
  };
}
