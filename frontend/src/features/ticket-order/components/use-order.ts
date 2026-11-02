import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { createPublicApi, type ApiClient } from '@/api/client';
import { isApiError } from '@/api/errors';
import { readPublicEnv } from '@/config/env';
import { fetchPublicEvent, type PublicEvent } from '@/features/public-event';
import { pollUntil, waitFor } from '@/lib/poll';
import { useIsHydrated } from '@/ui';

import { confirmOrder, fetchOrder } from '../api';
import { orderOutcome } from '../outcome';
import { heldOrder, type HeldOrder } from '../token-store';
import type { OrderRead } from '../types';

export type OrderState =
  | { kind: 'loading' }
  /** This tab holds no order: opened elsewhere, or its storage was cleared. */
  | { kind: 'none' }
  /** The order's link opens nothing (404). */
  | { kind: 'gone' }
  | { kind: 'failed'; requestId?: string | undefined }
  | { kind: 'ready'; read: OrderRead };

/** After the bank's return, confirm is asked again at 2, 5 and 10 seconds while the bank is silent. */
const RECHECKS = [2_000, 3_000, 5_000] as const;

function failure(error: unknown): OrderState {
  if (isApiError(error) && error.status === 404) return { kind: 'gone' };
  return { kind: 'failed', requestId: isApiError(error) ? error.requestId : undefined };
}

function usePublicApi() {
  const { i18n } = useTranslation();
  const language = i18n.language;
  return useMemo(
    () => createPublicApi(readPublicEnv().VITE_API_BASE_URL, { getLanguage: () => language }),
    [language],
  );
}

/** The event's names and times, when this tab came from checkout (FR-62); `null` otherwise. */
export function useOrderEvent(held: HeldOrder | null): PublicEvent | null {
  const api = usePublicApi();
  const { i18n } = useTranslation();
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const slug = held?.slug;
  useEffect(() => {
    if (!slug) return;
    let isCurrent = true;
    fetchPublicEvent(api, { slug, locale: i18n.language })
      .then((read) => isCurrent && setEvent(read))
      .catch(() => undefined);
    return () => {
      isCurrent = false;
    };
  }, [api, slug, i18n.language]);
  return event;
}

/**
 * Confirm refuses (400) an order with nothing to ask the bank: one cancelled or refunded meanwhile,
 * or one that never started a payment (`ticketing.service.ts`, `confirmOrder`). That is an answer,
 * not a failure: the order is read and shown as it is.
 */
async function confirmOrRead(api: ApiClient, accessToken: string): Promise<OrderRead> {
  try {
    return await confirmOrder(api, accessToken);
  } catch (error) {
    if (isApiError(error) && error.status === 400) return fetchOrder(api, accessToken);
    throw error;
  }
}

interface Opening {
  api: ApiClient;
  order: HeldOrder;
  confirmFirst: boolean;
  signal: AbortSignal;
}

/** Reads the order, or confirms it first; then, after the bank, asks again while it is silent. */
async function openOrder(
  { api, order, confirmFirst, signal }: Opening,
  show: (state: OrderState) => void,
) {
  try {
    const first = await (confirmFirst ? confirmOrRead : fetchOrder)(api, order.accessToken);
    if (signal.aborted) return;
    show({ kind: 'ready', read: first });
    if (!confirmFirst || orderOutcome(first.order) !== 'awaitingBank') return;
    const settled = await pollUntil({
      read: () => confirmOrRead(api, order.accessToken),
      isDone: (next) => orderOutcome(next.order) !== 'awaitingBank',
      delays: RECHECKS,
      wait: waitFor,
      signal,
    });
    if (settled && !signal.aborted) show({ kind: 'ready', read: settled });
  } catch (error) {
    if (!signal.aborted) show(failure(error));
  }
}

function shownState(isHydrated: boolean, held: HeldOrder | null, fetched: OrderState): OrderState {
  if (!isHydrated) return { kind: 'loading' };
  return held ? fetched : { kind: 'none' };
}

/**
 * The order this tab holds, read in the browser only: the server never sees the token (design
 * PD-81). On the bank's return it is confirmed first, since the return proves nothing
 * (docs/PAYMENTS.md §1), and confirmed again a few times while the bank has not answered.
 */
export function useOrder({ confirmFirst }: { confirmFirst: boolean }) {
  const api = usePublicApi();
  const isHydrated = useIsHydrated();
  const held = useMemo(() => (isHydrated ? heldOrder() : null), [isHydrated]);
  const [fetched, setFetched] = useState<OrderState>({ kind: 'loading' });
  const [isChecking, setIsChecking] = useState(false);

  useEffect(() => {
    if (!held) return;
    const stop = new AbortController();
    void openOrder({ api, order: held, confirmFirst, signal: stop.signal }, setFetched);
    return () => stop.abort();
  }, [api, held, confirmFirst]);

  async function check() {
    if (!held) return;
    setIsChecking(true);
    try {
      setFetched({ kind: 'ready', read: await confirmOrRead(api, held.accessToken) });
    } catch (error) {
      setFetched(failure(error));
    } finally {
      setIsChecking(false);
    }
  }

  return {
    state: shownState(isHydrated, held, fetched),
    held,
    isChecking,
    check: () => void check(),
  };
}
