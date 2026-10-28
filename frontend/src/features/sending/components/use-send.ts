import { useState } from 'react';
import { useRevalidator } from 'react-router';

import { browserSession } from '@/api/session';

import { sendInvitation } from '../api';
import { refusalOf, type Refusal } from '../refusals';
import { needsConfirmation } from '../send';
import type { DeliveryReport, SendOutcome } from '../types';

/** A send waiting for the host's yes: to whom, and how many households that is when known. */
export interface PendingSend {
  guestIds: readonly string[] | null;
  households: number | null;
}

interface SendOptions {
  slug: string;
  report: DeliveryReport | null;
  /** After a send went through: the guest list clears what was chosen. */
  onSent?: () => void;
}

/**
 * Sending, from the invitation page or the guest list (design PD-47). The event's first send asks
 * once (`needsConfirmation`); after that a press sends at once. The button is disabled only while
 * its request runs: pressing again afterwards is safe, since the backend sends no household a
 * second invitation and tries again only what failed (docs/API.md §6). The page reloads after each
 * send, so the delivery report shows what it did.
 */
export function useSend({ slug, report, onSent }: SendOptions) {
  const { revalidate } = useRevalidator();
  const [isSending, setIsSending] = useState(false);
  const [outcome, setOutcome] = useState<SendOutcome | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [pending, setPending] = useState<PendingSend | null>(null);

  const sendNow = async (guestIds: readonly string[] | null) => {
    setRefusal(null);
    setIsSending(true);
    try {
      const result = await sendInvitation(browserSession().api, slug, guestIds ?? undefined);
      setOutcome(result);
      onSent?.();
      await revalidate();
    } catch (error) {
      const found = refusalOf(error);
      setRefusal(found);
      if (found.isStale) void revalidate();
    } finally {
      setIsSending(false);
    }
  };

  const request = (send: PendingSend) => {
    if (needsConfirmation(report)) setPending(send);
    else void sendNow(send.guestIds);
  };
  const confirm = () => {
    const send = pending;
    setPending(null);
    if (send) void sendNow(send.guestIds);
  };
  const cancel = () => setPending(null);

  return { isSending, outcome, refusal, pending, request, confirm, cancel };
}
