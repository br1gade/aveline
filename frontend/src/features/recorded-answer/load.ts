import type { ApiClient } from '@/api/client';
import { loaded, type Loaded } from '@/api/loaded';
import { getEvent, type EventDetail } from '@/features/events';
import { listGuests } from '@/features/guests';
import { getDesign } from '@/features/invitation-design';

import { getAnsweringGuest } from './api';
import { askingOf, NOTHING_ASKED, type Asking } from './asking';
import type { AnsweringGuest } from './types';

export interface RecordAnswerData {
  event: EventDetail;
  /** Refused to a role that can't read the guest list (a designer), which is worded. */
  guest: Loaded<AnsweringGuest>;
  /** What the invitation asks; nothing beyond attendance when it has none or can't be read. */
  asking: Asking;
  isAskingKnown: boolean;
}

async function askingFor(api: ApiClient, event: EventDetail) {
  if (!event.invitation) return { asking: NOTHING_ASKED, isAskingKnown: true };
  const design = await loaded(getDesign(api, event.invitation.slug));
  return design.kind === 'ready'
    ? { asking: askingOf(design.value, event.defaultLocale), isAskingKnown: true }
    : { asking: NOTHING_ASKED, isAskingKnown: false };
}

export async function loadRecordAnswer(
  api: ApiClient,
  eventId: string,
  guestId: string,
): Promise<RecordAnswerData> {
  const event = await getEvent(api, eventId);
  const [guest, asked] = await Promise.all([
    loaded(getAnsweringGuest(api, eventId, guestId)),
    askingFor(api, event),
  ]);
  return { event, guest, ...asked };
}

/** A household as its page records it: each member with their answers so far, in its order. */
export interface HouseholdToAnswer {
  id: string;
  name: string;
  members: AnsweringGuest[];
}

export interface HouseholdAnswersData {
  event: EventDetail;
  /** `null` when the household is no longer on the list: an old link, or it was removed. */
  household: Loaded<HouseholdToAnswer | null>;
  asking: Asking;
  isAskingKnown: boolean;
}

/**
 * The list gives the household and its members, but not their answers to the host's questions, so
 * each is read on its own. **A temporary stand-in** under FR-118: one at a time, as twenty members
 * read at once would pass the API's ten a second.
 */
async function readHousehold(
  api: ApiClient,
  eventId: string,
  householdId: string,
): Promise<HouseholdToAnswer | null> {
  const found = (await listGuests(api, eventId)).find(({ id }) => id === householdId);
  if (!found) return null;
  const members = await found.guests.reduce<Promise<AnsweringGuest[]>>(
    async (read, { id }) => [...(await read), await getAnsweringGuest(api, eventId, id)],
    Promise.resolve([]),
  );
  return { id: found.id, name: found.name, members };
}

export async function loadHouseholdAnswers(
  api: ApiClient,
  eventId: string,
  householdId: string,
): Promise<HouseholdAnswersData> {
  const event = await getEvent(api, eventId);
  const [household, asked] = await Promise.all([
    loaded(readHousehold(api, eventId, householdId)),
    askingFor(api, event),
  ]);
  return { event, household, ...asked };
}
