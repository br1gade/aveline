import type { ApiClient } from '@/api/client';
import { fetchPaymentOptions, type PaymentOptions } from '@/api/payment-options';
import { getEvent, type EventDetail } from '@/features/events';
import { listMedia, type LibraryItem } from '@/features/invitation-design';

import { getListing, listTicketTypes } from './api';
import type { Listing, TicketType } from './types';

export interface TicketSalesData {
  event: EventDetail;
  types: TicketType[];
  listing: Listing | null;
  /** While payments are off a ticket must be free, and one priced before can't be bought (F-09). */
  payment: PaymentOptions;
}

/** The event, its ticket types and its announcement, in parallel. */
export async function loadTicketSales(api: ApiClient, eventId: string): Promise<TicketSalesData> {
  const [event, types, listing, payment] = await Promise.all([
    getEvent(api, eventId),
    listTicketTypes(api, eventId),
    getListing(api, eventId),
    fetchPaymentOptions(api),
  ]);
  return { event, types, listing, payment };
}

export interface TicketTypeData {
  event: EventDetail;
  /** `null` when adding one, or when it is no longer on the event. */
  type: TicketType | null;
  isGone: boolean;
  /** Read before the price is typed: while payments are off, only a free ticket is offered. */
  payment: PaymentOptions;
}

/** There is no single-type read; the list is short and holds everything the form shows. */
export async function loadTicketType(
  api: ApiClient,
  eventId: string,
  typeId: string | null,
): Promise<TicketTypeData> {
  const [event, types, payment] = await Promise.all([
    getEvent(api, eventId),
    typeId ? listTicketTypes(api, eventId) : [],
    fetchPaymentOptions(api),
  ]);
  const type = types.find((candidate) => candidate.id === typeId) ?? null;
  return { event, type, isGone: typeId !== null && type === null, payment };
}

export interface AnnouncementData {
  event: EventDetail;
  listing: Listing | null;
  /** The event's pictures, which the announcement may show and share. */
  pictures: LibraryItem[];
}

const PICTURE_KINDS: ReadonlySet<string> = new Set(['PHOTO', 'COVER', 'LOGO']);

export async function loadAnnouncement(api: ApiClient, eventId: string): Promise<AnnouncementData> {
  const [event, listing, media] = await Promise.all([
    getEvent(api, eventId),
    getListing(api, eventId),
    listMedia(api, eventId),
  ]);
  return { event, listing, pictures: media.filter((item) => PICTURE_KINDS.has(item.kind)) };
}
