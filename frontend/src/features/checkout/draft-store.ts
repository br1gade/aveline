import { z } from 'zod';

import { sessionValue, type SessionValue } from '@/lib/session-store';

import type { CheckoutValues, TicketSelection } from './types';

/**
 * An order being typed, kept in this tab's `sessionStorage` so that a reload loses none of it
 * (design PD-152, audit F-21). One per event, cleared once the order is placed. It holds what the
 * buyer typed and the seats they chose; never the order's link or its retry key, and not the promo
 * code, which is checked again against the basket.
 */
const PREFIX = 'aveline-checkout-draft:';

export interface CheckoutDraft {
  /** The event, layout and basket it was typed for: another of any makes it stale. */
  scope: string;
  /** How guests answered when it was typed (docs/API.md §5); once changed, places are asked again. */
  revision: number;
  values: CheckoutValues;
  picks: Record<number, TicketSelection>;
}

const answer = z.union([z.string(), z.array(z.string()), z.boolean(), z.null()]).optional();
const venue = z.enum(['ATTENDING', 'DECLINED', 'UNDECIDED', '']).nullable().optional();

const draftShape = z.object({
  scope: z.string(),
  revision: z.number(),
  values: z.object({
    buyerFirstName: z.string(),
    buyerLastName: z.string(),
    buyerEmail: z.string(),
    buyerPhone: z.string(),
    people: z.array(
      z.object({
        ticketTypeId: z.string(),
        firstName: z.string(),
        lastName: z.string(),
        email: z.string(),
        phone: z.string(),
        isBuyer: z.boolean(),
        dietary: z.array(z.string()),
        dietaryNotes: z.string(),
        drink: z.string(),
        answers: z.record(z.string(), answer),
        venues: z.record(z.string(), venue),
      }),
    ),
  }),
  picks: z.record(z.string(), z.object({ sectionKey: z.string(), seatId: z.string().optional() })),
});

function isCheckoutDraft(value: unknown): value is CheckoutDraft {
  return draftShape.safeParse(value).success;
}

export function checkoutDraftStore(slug: string): SessionValue<CheckoutDraft> {
  return sessionValue(`${PREFIX}${slug}`, isCheckoutDraft);
}
