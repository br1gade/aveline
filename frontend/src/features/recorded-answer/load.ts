import type { ApiClient } from '@/api/client';
import { loaded, type Loaded } from '@/api/loaded';
import { getEvent, type EventDetail } from '@/features/events';
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
