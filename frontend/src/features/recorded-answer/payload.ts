import type { components } from '@/api/schema';

import { isAnswerable, type AskedQuestion, type Asking, type HostField } from './asking';
import type { AnswerFormValues, FormAnswer } from './form-model';
import type { AnsweringGuest, Reply } from './types';

type HostRsvp = components['schemas']['HostRsvpDto'];
type CustomAnswer = components['schemas']['CustomAnswerDto'];

function isSame(a: FormAnswer, b: FormAnswer): boolean {
  return Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((one) => b.includes(one))
    : a === b;
}

function isEmpty(answer: FormAnswer): boolean {
  return Array.isArray(answer) ? answer.length === 0 : answer.trim() === '';
}

/** The value the backend takes for each kind of question (`answers.ts`). */
function wireValue(question: AskedQuestion, answer: FormAnswer): CustomAnswer['value'] {
  if (Array.isArray(answer)) return answer.map(Number).sort((a, b) => a - b);
  if (question.type === 'BOOLEAN') return answer === 'yes';
  if (question.type === 'SINGLE_CHOICE') return Number(answer);
  return answer.trim();
}

/**
 * The host's own questions changed. An answer can't be taken back (the backend requires a value),
 * so one emptied is left as it was; a signature is never sent, as only the guest can give it.
 */
function changedAnswers(asking: Asking, initial: AnswerFormValues, values: AnswerFormValues) {
  return asking.questions.filter(isAnswerable).flatMap((question): CustomAnswer[] => {
    const before = initial.answers[question.id] ?? '';
    const after = values.answers[question.id] ?? '';
    if (isEmpty(after) || isSame(before, after)) return [];
    return [{ questionId: question.id, value: wireValue(question, after) }];
  });
}

/**
 * In PER_VENUE, the venues whose answer changed. The backend needs one at least, so when only
 * another field changed, every venue already answered is sent again as it stands, which changes
 * nothing; venues left out keep their answers.
 */
function venueAnswers(initial: AnswerFormValues, values: AnswerFormValues) {
  const given = Object.entries(values.venues).filter(
    (pair): pair is [string, Reply] => pair[1] !== '',
  );
  const changed = given.filter(([venueId, reply]) => initial.venues[venueId] !== reply);
  return (changed.length > 0 ? changed : given).map(([venueId, status]) => ({ venueId, status }));
}

function dietaryOf(values: AnswerFormValues, isChosen: boolean): string[] {
  if (isChosen) return values.dietary;
  const text = values.dietaryText.trim();
  return text ? [text] : [];
}

/** The built-in questions switched on whose answers changed; an emptied one is cleared. */
function changedFields(asking: Asking, initial: AnswerFormValues, values: AnswerFormValues) {
  const body: Partial<HostRsvp> = {};
  for (const { field, options } of asking.fields) {
    if (field === 'dietary') {
      const isChosen = options !== null;
      const after = dietaryOf(values, isChosen);
      if (!isSame(dietaryOf(initial, isChosen), after)) body.dietary = after;
      if (values.dietaryNotes.trim() !== initial.dietaryNotes.trim()) {
        body.dietaryNotes = values.dietaryNotes.trim();
      }
      continue;
    }
    const text = values[field satisfies Exclude<HostField, 'dietary'>].trim();
    if (text !== initial[field].trim()) body[field] = text;
  }
  return body;
}

/** Per venue, or one answer for the event, which the form requires before sending. */
function attendanceOf(guest: AnsweringGuest, initial: AnswerFormValues, values: AnswerFormValues) {
  if (guest.mode === 'PER_VENUE') return { venueAttendance: venueAnswers(initial, values) };
  return values.status ? { status: values.status } : {};
}

/**
 * What a host records (docs/API.md §6). Only what changed is sent, since omitted fields keep their
 * value; the event-wide answer always goes, as the backend requires it there. The revision the form
 * was read at goes too: a change of how guests answer since then is refused, not overwritten.
 */
export function answerPayload(
  guest: AnsweringGuest,
  asking: Asking,
  initial: AnswerFormValues,
  values: AnswerFormValues,
): HostRsvp {
  const answers = changedAnswers(asking, initial, values);
  return {
    attendanceRevision: guest.revision,
    ...attendanceOf(guest, initial, values),
    ...changedFields(asking, initial, values),
    ...(answers.length > 0 ? { answers } : {}),
    ...(values.notifyGuest ? { notifyGuest: true } : {}),
  };
}
