import { useCallback, useMemo, useState } from 'react';

import type { EventDetail } from '@/features/events';
import { guestIdsFor, useSend, type DeliveryReport } from '@/features/sending';

import type { Household } from '../types';

interface SendFromListOptions {
  event: EventDetail;
  households: readonly Household[];
  report: DeliveryReport | null;
}

/**
 * The households chosen on the list, and sending to them (design PD-48). Chosen by household, the
 * unit an invitation goes to: one guest of each is named (`guestIdsFor`). A household that leaves
 * the list leaves the choice with it. The choice clears once a send goes through.
 */
export function useSendFromList({ event, households, report }: SendFromListOptions) {
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set());
  const clear = useCallback(() => setChosen(new Set()), []);
  const send = useSend({ slug: event.invitation?.slug ?? '', report, onSent: clear });
  const choose = useCallback((householdId: string, isChosen: boolean) => {
    setChosen((current) => {
      const next = new Set(current);
      if (isChosen) next.add(householdId);
      else next.delete(householdId);
      return next;
    });
  }, []);
  const chooseAll = useCallback((householdIds: readonly string[]) => {
    setChosen((current) => new Set([...current, ...householdIds]));
  }, []);
  const chosenHouseholds = useMemo(
    () => households.filter((household) => chosen.has(household.id)),
    [households, chosen],
  );
  const target = guestIdsFor(chosenHouseholds);
  const sendChosen = () => {
    if (target.kind !== 'ready' || target.guestIds.length === 0) return;
    send.request({ guestIds: target.guestIds, households: chosenHouseholds.length });
  };
  return {
    chosen,
    choose,
    chooseAll,
    clear,
    count: chosenHouseholds.length,
    isTooMany: target.kind === 'tooMany',
    sendChosen,
    send,
  };
}
