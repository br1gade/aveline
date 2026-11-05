import { useState } from 'react';
import { useRevalidator } from 'react-router';

import { browserSession } from '@/api/session';

import { sendInvitation } from '../api';
import { refusalOf, type Refusal } from '../refusals';
import { needsConfirmation, sendInBatches } from '../send';
import type { DeliveryReport, SendOutcome } from '../types';

/** A send waiting for the host's yes: to whom, and how many households that is when known. */
export interface PendingSend {
  guestIds: readonly string[] | null;
  households: number | null;
}

/** Which part of a send too large for one request is going (design PD-151). */
export interface SendProgress {
  current: number;
  total: number;
}

/** A send that stopped partway: how many of the households named went. */
export interface PartlySent {
  sent: number;
  total: number;
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
 * send, so the delivery report shows what it did. More households chosen than one send takes go a
 * part at a time (PD-151); one refused partway says how many went, and the page reloads too.
 */
export function useSend({ slug, report, onSent }: SendOptions) {
  const { revalidate } = useRevalidator();
  const [isSending, setIsSending] = useState(false);
  const [outcome, setOutcome] = useState<SendOutcome | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [pending, setPending] = useState<PendingSend | null>(null);
  const [progress, setProgress] = useState<SendProgress | null>(null);
  const [partly, setPartly] = useState<PartlySent | null>(null);

  /** Everyone not yet invited is one request; households chosen go in parts of at most 1,000. */
  const sendTo = (guestIds: readonly string[] | null) => {
    const { api } = browserSession();
    if (!guestIds) {
      return sendInvitation(api, slug).then((outcome) => ({ outcome, sent: 0, error: null }));
    }
    return sendInBatches(
      guestIds,
      (batch) => sendInvitation(api, slug, batch),
      (index, total) => setProgress(total > 1 ? { current: index + 1, total } : null),
    );
  };

  const sendNow = async (guestIds: readonly string[] | null) => {
    setRefusal(null);
    setPartly(null);
    setIsSending(true);
    const {
      outcome: result,
      sent,
      error,
    } = await sendTo(guestIds).catch((thrown: unknown) => ({
      outcome: null,
      sent: 0,
      error: thrown,
    }));
    setProgress(null);
    setIsSending(false);
    setOutcome(result);
    if (error === null) {
      onSent?.();
      await revalidate();
      return;
    }
    const found = refusalOf(error);
    setRefusal(found);
    if (guestIds && sent > 0) setPartly({ sent, total: guestIds.length });
    if (found.isStale || sent > 0) void revalidate();
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

  return { isSending, progress, outcome, partly, refusal, pending, request, confirm, cancel };
}
