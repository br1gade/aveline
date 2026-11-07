import type { Asking } from './asking';
import type { AnswerFormValues } from './form-model';
import { answerPayload, type HostRsvp } from './payload';
import type { AnsweringGuest } from './types';

/** One member's form on the household's page: as read, and as it stands. */
export interface MemberEdit {
  guest: AnsweringGuest;
  initial: AnswerFormValues;
  values: AnswerFormValues;
}

export interface MemberRecord {
  guest: AnsweringGuest;
  body: HostRsvp;
}

/**
 * Whether the member's form says anything the backend would record: what is sent is compared, not
 * the form, so the same choices in another order are no change.
 */
export function isMemberChanged(asking: Asking, { guest, initial, values }: MemberEdit): boolean {
  const sent = answerPayload(guest, asking, initial, values);
  const unchanged = answerPayload(guest, asking, initial, initial);
  return JSON.stringify(sent) !== JSON.stringify(unchanged);
}

/**
 * What recording a household sends: one answer for each member who changed, in the household's
 * order. A member left as read is not sent, so one who hasn't answered is never asked to (design
 * PD-147). Telling the guest is the household's choice, for each member recorded.
 */
export function householdRecords(
  asking: Asking,
  edits: readonly MemberEdit[],
  shouldNotify: boolean,
): MemberRecord[] {
  return edits
    .filter((edit) => isMemberChanged(asking, edit))
    .map(({ guest, initial, values }) => ({
      guest,
      body: answerPayload(guest, asking, initial, { ...values, notifyGuest: shouldNotify }),
    }));
}
