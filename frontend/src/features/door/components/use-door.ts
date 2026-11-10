import { useCallback, useReducer } from 'react';

import type { EventDetail } from '@/features/events';

import { doorReducer, INITIAL_DOOR } from '../arrival';
import { doorActions } from './door-actions';
import { useArrivals } from './use-arrivals';
import { useGuestRead } from './use-guest-read';
import { useMustAgree } from './use-must-agree';

/**
 * The door's data and its writes. One write runs at a time; each answer moves the focus to its
 * outcome (`DoorResultLine`).
 */
export function useDoor(event: EventDetail) {
  const [state, dispatch] = useReducer(doorReducer, INITIAL_DOOR);
  const onListStart = useCallback(() => dispatch({ type: 'listReadStarted' }), []);
  const onListRead = useCallback(() => dispatch({ type: 'listRead' }), []);
  const guests = useGuestRead(event.id, onListStart, onListRead);
  const mustAgree = useMustAgree(event);
  const arrivals = useArrivals(event.id);
  const actions = doorActions({
    eventId: event.id,
    dispatch,
    guestOf: (guestId) => guests.byId.get(guestId),
    reloadGuests: () => void guests.reload(),
    refreshGuest: (name) => void guests.refreshGuest(name),
    refreshAgreements: () => void mustAgree.refresh(),
    refreshCounts: arrivals.refresh,
  });
  return { state, guests, mustAgree, arrivals: arrivals.read, actions };
}

export type Door = ReturnType<typeof useDoor>;
