import type { ApiClient } from '@/api/client';
import { isApiError } from '@/api/errors';

import { getEvent, switchOffOptionalQuestions } from './api';

/** What a page is sent with when drink and song request couldn't be switched off (PD-179). */
export interface QuestionsLeftOn {
  questionsLeftOnFor: string;
}

/**
 * After an event or its invitation is created: drink and song request switched off (C-30). Event
 * creation doesn't answer with the invitation's link name, so the event is read for it. Returns
 * what to send the next page with when that failed, so the host is told rather than surprised.
 */
export async function startQuestionsOff(
  api: ApiClient,
  eventId: string,
): Promise<QuestionsLeftOn | null> {
  try {
    const { invitation } = await getEvent(api, eventId);
    if (invitation) await switchOffOptionalQuestions(api, invitation.slug);
    return null;
  } catch (error) {
    if (!isApiError(error)) throw error;
    return { questionsLeftOnFor: eventId };
  }
}

export function questionsLeftOnFor(state: unknown): string | null {
  const value = (state as Partial<QuestionsLeftOn> | null)?.questionsLeftOnFor;
  return typeof value === 'string' ? value : null;
}
