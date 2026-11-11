import { expectData, type PublicApiClient } from '@/api/client';
import type { BasketLine } from '@/features/public-event';

import type { OrderBody, PlacedOrder, PromoQuote } from './types';

type Wire = Record<string, unknown>;

function record(value: unknown): Wire {
  return typeof value === 'object' && value !== null ? (value as Wire) : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Checkout's answer, kept only as far as the next step needs: the access token, which the tab
 * holds, the status, and the bank's page. Attendees, tickets and codes are read on the order page.
 */
function readPlaced(value: unknown): PlacedOrder {
  const wire = record(value);
  const accessToken = text(wire.accessToken);
  if (!accessToken) throw new TypeError('The order came back without its access token');
  return {
    accessToken,
    status: text(wire.status) ?? 'RESERVED',
    redirectUrl: text(record(wire.payment).redirectUrl),
  };
}

/** `POST /public/events/:slug/orders` (docs/API.md §5). The same key again returns the same order. */
export async function placeOrder(
  api: PublicApiClient,
  slug: string,
  order: OrderBody & { idempotencyKey: string },
): Promise<PlacedOrder> {
  const wire = await expectData(
    api.POST('/api/v1/public/events/{slug}/orders', {
      params: { path: { slug } },
      body: order,
    }),
  );
  return readPlaced(wire);
}

/** `POST /public/events/:slug/promo-check`: what a code is worth on this basket, priced by the server. */
export async function checkPromoCode(
  api: PublicApiClient,
  slug: string,
  check: { code: string; items: readonly BasketLine[] },
): Promise<PromoQuote> {
  const wire = record(
    await expectData(
      api.POST('/api/v1/public/events/{slug}/promo-check', {
        params: { path: { slug } },
        body: {
          code: check.code,
          items: check.items.map(({ ticketTypeId, quantity }) => ({ ticketTypeId, quantity })),
        },
      }),
    ),
  );
  return {
    code: text(wire.code) ?? check.code,
    isApplicable: wire.isApplicable === true,
    reason: text(wire.reason),
    subtotalMinor: text(wire.subtotalMinor) ?? '0',
    discountMinor: text(wire.discountMinor) ?? '0',
    totalMinor: text(wire.totalMinor) ?? '0',
    currency: text(wire.currency) ?? 'AMD',
  };
}
