import type { Dispatch } from 'react';

import { browserSession } from '@/api/session';
import { addGuest } from '@/features/guests';

import { admitTicket, checkIn, undoCheckIn } from '../api';
import { CODE_RUNNING, WALK_IN_RUNNING, type DoorEvent } from '../arrival';
import { isListStale, refusalOf, type DoorRefusal } from '../refusals';
import { walkInBody, walkInName, type WalkInValues } from '../walk-in';
import type { DoorGuest } from '../types';

export interface DoorActions {
  checkIn: (guest: DoorGuest) => Promise<void>;
  /** The refusal to add them, for the form to show; `null` once they are on the list. */
  walkIn: (values: WalkInValues) => Promise<DoorRefusal | null>;
  undo: (guest: DoorGuest) => Promise<void>;
  /** Whether the field should be emptied: the code was answered and is done with. */
  admit: (code: string) => Promise<boolean>;
  codeEdited: () => void;
  dismiss: () => void;
}

interface DoorActionsContext {
  eventId: string;
  dispatch: Dispatch<DoorEvent>;
  guestOf: (guestId: string) => DoorGuest | undefined;
  reloadGuests: () => void;
  /** One person read again by name, once their arrival is recorded (FR-79). */
  refreshGuest: (name: string) => void;
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
 * Adds a walk-in with the guest list's own call, then checks them in (design PD-148). A refusal to
 * add them goes back to the form; once added, the outcome is the door's like any arrival's.
 */
function walkInAction({ eventId, dispatch, refreshGuest, refreshCounts }: DoorActionsContext) {
  return async (values: WalkInValues): Promise<DoorRefusal | null> => {
    dispatch({ type: 'sent', running: WALK_IN_RUNNING });
    let id: string;
    try {
      ({ id } = await addGuest(browserSession().api, eventId, walkInBody(values)));
    } catch (error) {
      dispatch({ type: 'walkInRefused' });
      const refusal = refusalOf(error, 'checkIn');
      // Adding takes no key (FR-119): one with no answer may have been added, so they are looked for.
      if (refusal.kind === 'noAnswer') refreshGuest(walkInName(values));
      return refusal;
    }
    // On the roster now, so Undo and a second try find them there.
    refreshGuest(walkInName(values));
    dispatch({ type: 'sent', running: id });
    try {
      dispatch({ type: 'checkedIn', answer: await checkIn(browserSession().api, eventId, id) });
      refreshCounts();
    } catch (error) {
      const refusal = refusalOf(error, 'checkIn');
      dispatch({ type: 'walkInNotHere', guestId: id, name: walkInName(values), refusal });
    }
    return null;
  };
}

/**
 * The door's writes. Nothing is shown as done before the server answers, and a refusal that shows
 * the page out of date reads again only what it needs.
 */
export function doorActions(context: DoorActionsContext): DoorActions {
  const { eventId, dispatch, guestOf, reloadGuests, refreshAgreements, refreshCounts } = context;
  const { refreshGuest } = context;
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
        dispatch({ type: 'checkedIn', answer });
        refreshGuest(answer.name);
        refreshCounts();
      } catch (error) {
        const refusal = refusalOf(error, 'checkIn');
        dispatch({ type: 'checkInRefused', guest, refusal });
        followUp(refusal);
      }
    },
    walkIn: walkInAction(context),
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
        // Their row read again, or added when the roster doesn't hold them yet.
        if (answer.guestId !== null) refreshGuest(guest?.name ?? answer.holderName ?? '');
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
