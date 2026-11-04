import { useState } from 'react';
import { useNavigate, useRevalidator } from 'react-router';

import { createRetryKey } from '@/api/retry-key';
import type { Basket, PublicEvent } from '@/features/public-event';
import { holdOrder } from '@/features/ticket-order';
import { bankAddress, leaveForBank } from '@/lib/links';
import { isLanguage } from '@/lib/i18n';
import { APP_PATHS } from '@/route-paths';

import { placeOrder } from '../api';
import { intentOf, orderBody } from '../payload';
import { checkoutRefusal, type CheckoutRefusal } from '../refusals';
import type { CheckoutValues, PaymentProvider } from '../types';
import { useCheckoutApi } from './use-checkout-api';

/** Refusals that mean the page's copy of the event is out of date: it is read again. */
const READ_AGAIN: ReadonlySet<CheckoutRefusal['kind']> = new Set([
  'staleRevision',
  'soldOut',
  'notOnSale',
  'salesClosed',
  'salesNotOpen',
  'orderLimits',
  'notFound',
]);

interface CheckoutInput {
  event: PublicEvent;
  basket: Basket;
  provider: PaymentProvider;
}

/**
 * Placing the order. One idempotency key per attempt (docs/API.md §5): a press after no answer or
 * a server failure sends the same key with the same order, and gets the order the first press
 * may have made, with its payment; anything changed, or any refusal, makes a new one. A retry is
 * always the buyer's own press, never automatic.
 */
export function useCheckout({ event, basket, provider }: CheckoutInput) {
  const api = useCheckoutApi(event.locale);
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [retry] = useState(() => createRetryKey());
  const [refusal, setRefusal] = useState<CheckoutRefusal | null>(null);
  const [isSending, setIsSending] = useState(false);

  /** Places the order; resolves to the refusal, or `null` once the buyer is on their way. */
  async function submit(
    values: CheckoutValues,
    promoCode: string | null,
  ): Promise<CheckoutRefusal | null> {
    const context = { rules: event.checkout, basket, locale: event.locale, provider, promoCode };
    const body = orderBody(values, context);
    setIsSending(true);
    setRefusal(null);
    try {
      const placed = await placeOrder(api, event.slug, {
        ...body,
        idempotencyKey: retry.next(intentOf(body)),
      });
      retry.settle(null);
      holdOrder({ accessToken: placed.accessToken, slug: event.slug });
      const bank =
        placed.status === 'RESERVED'
          ? bankAddress(placed.redirectUrl, window.location.origin)
          : null;
      if (bank) {
        leaveForBank(bank);
        return null;
      }
      const language = isLanguage(event.locale) ? `?lang=${event.locale}` : '';
      void navigate(`${APP_PATHS.ticketOrder}${language}`);
      return null;
    } catch (error) {
      retry.settle(error);
      const refused = checkoutRefusal(error);
      setRefusal(refused);
      if (READ_AGAIN.has(refused.kind)) void revalidator.revalidate();
      return refused;
    } finally {
      setIsSending(false);
    }
  }

  return { submit, refusal, isSending };
}
