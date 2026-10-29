import type { ApiClient } from '@/api/client';
import { isApiError } from '@/api/errors';
import { loaded, type Loaded } from '@/api/loaded';
import { getEvent, type EventDetail } from '@/features/events';
import { listGuests } from '@/features/guests';
import { getDesign, type Question } from '@/features/invitation-design';

import { listAgreements } from './api';
import type { AgreementsPage } from './types';

export interface AgreementsData {
  event: EventDetail;
  /**
   * The invitation's SIGNATURE questions in their order; none without an invitation, and `null`
   * when the design could not be read, so nothing is called current or no longer listed.
   */
  statements: Question[] | null;
  /**
   * Each guest's name by id: the records name no one (FR-49). Read through the guest list's own
   * reader, which drops every token. Empty when the list could not be read.
   */
  names: ReadonlyMap<string, string>;
  /** The newest hundred, or that this role may not read them (403: `guest:contact:read`). */
  records: Loaded<AgreementsPage>;
}

/** The API's refusal or failure leaves `fallback`; anything else is a bug, and is thrown on. */
async function orElse<T>(load: Promise<T>, fallback: T): Promise<T> {
  try {
    return await load;
  } catch (error) {
    if (!isApiError(error)) throw error;
    return fallback;
  }
}

async function signatureQuestions(api: ApiClient, event: EventDetail): Promise<Question[]> {
  if (!event.invitation) return [];
  const design = await getDesign(api, event.invitation.slug);
  return design.questions.filter((question) => question.type === 'SIGNATURE');
}

async function guestNames(api: ApiClient, eventId: string): Promise<Map<string, string>> {
  const households = await listGuests(api, eventId);
  return new Map(
    households.flatMap((household) => household.guests.map((guest) => [guest.id, guest.name])),
  );
}

/**
 * The event, then its statements, its guests' names and the first page of agreements in parallel
 * (design PD-66). Only the event's own failure fails the page; the names and statements only
 * make it clearer.
 */
export async function loadAgreements(api: ApiClient, eventId: string): Promise<AgreementsData> {
  const event = await getEvent(api, eventId);
  const [statements, names, records] = await Promise.all([
    orElse<Question[] | null>(signatureQuestions(api, event), null),
    orElse(guestNames(api, eventId), new Map<string, string>()),
    loaded(listAgreements(api, eventId)),
  ]);
  return { event, statements, names, records };
}
