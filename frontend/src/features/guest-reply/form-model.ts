import { z } from 'zod';

import type { RsvpQuestion } from '@/features/invitation-renderer';

import { LIMITS } from './options';
import type {
  AnswerPayload,
  ReplyRecord,
  ReplyStatus,
  SavedStatus,
  SubmitReplyBody,
} from './types';

/**
 * The reply form's values, how they start from the saved reply, how they are checked, and what is
 * sent. Kept apart from the components so the rules are tested on their own.
 */

/** Text, a position, or positions, as form inputs hold them: '' is unanswered. */
export type AnswerValue = string | string[];

export interface MemberValues {
  guestId: string;
  name: string;
  /** '' follows the respondent's answer until this person is answered for (spec §6.1a). */
  status: ReplyStatus | '';
  dietary: string[];
  dietaryNotes: string;
}

export interface PartyValues {
  firstName: string;
  lastName: string;
}

export type Attribution = '' | 'SIDE_A' | 'SIDE_B' | 'SHARED';

export interface ReplyFormValues {
  status: ReplyStatus | '';
  members: MemberValues[];
  party: PartyValues[];
  attribution: Attribution;
  dietary: string[];
  dietaryNotes: string;
  drinkPreference: string;
  songRequest: string;
  message: string;
  answers: Record<string, AnswerValue>;
}

/** SIGNATURE questions cannot be answered yet, so they are never shown (PD-23). */
export function answerableQuestions(questions: readonly RsvpQuestion[]): RsvpQuestion[] {
  return questions.filter((question) => question.type !== 'SIGNATURE');
}

export function fullName(person: { firstName: string; lastName: string | null }): string {
  return [person.firstName, person.lastName].filter(Boolean).join(' ');
}

const FORM_BOOLEAN: Readonly<Record<string, boolean>> = { yes: true, no: false };

function booleanToForm(value: unknown): AnswerValue {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return '';
}

function savedToForm(question: RsvpQuestion, value: unknown): AnswerValue {
  switch (question.type) {
    case 'BOOLEAN':
      return booleanToForm(value);
    case 'SINGLE_CHOICE':
      return typeof value === 'number' ? String(value) : '';
    case 'MULTI_CHOICE':
      return Array.isArray(value)
        ? value.filter((item) => typeof item === 'number').map(String)
        : [];
    default:
      return typeof value === 'string' ? value : '';
  }
}

function asFormStatus(status: SavedStatus): ReplyStatus | '' {
  return status === 'PENDING' ? '' : status;
}

/** The form as the saved reply leaves it. A first reply starts with nothing chosen. */
export function initialValues(
  record: ReplyRecord,
  questions: readonly RsvpQuestion[],
): ReplyFormValues {
  const { rsvp } = record;
  const saved = new Map(rsvp.answers.map((answer) => [answer.questionId, answer.value]));
  return {
    status: asFormStatus(rsvp.status),
    members: record.household.members.map((member) => ({
      guestId: member.id,
      name: fullName(member),
      status: asFormStatus(member.status),
      dietary: member.dietary,
      dietaryNotes: member.dietaryNotes ?? '',
    })),
    party: [],
    attribution: '',
    dietary: rsvp.dietary ?? [],
    dietaryNotes: rsvp.dietaryNotes ?? '',
    drinkPreference: rsvp.drinkPreference ?? '',
    songRequest: rsvp.songRequest ?? '',
    message: rsvp.message ?? '',
    answers: Object.fromEntries(
      answerableQuestions(questions).map((question) => [
        question.id,
        savedToForm(question, saved.get(question.id)),
      ]),
    ),
  };
}

export function isAnswered(value: AnswerValue | undefined): boolean {
  return Array.isArray(value) ? value.length > 0 : Boolean(value?.trim());
}

/** The codes the form's messages are looked up by (`reply:errors.*`). */
export type ErrorCode = 'chooseAnswer' | 'firstName' | 'tooLong' | 'required';

const tooLong = (limit: number) => z.string().max(limit, { error: 'tooLong' satisfies ErrorCode });

function questionLimit(question: RsvpQuestion): number | undefined {
  if (question.type === 'TEXT') return LIMITS.text;
  if (question.type === 'LONG_TEXT') return LIMITS.longText;
  return undefined;
}

/**
 * The checks a guest can fix before sending. The server stays the authority: whatever it refuses
 * maps onto the same fields (server-errors.ts).
 */
export function replySchema(questions: readonly RsvpQuestion[]) {
  const answerable = answerableQuestions(questions);
  return z
    .object({
      // '' until the guest chooses, so the schema's input and output match the form's values.
      status: z
        .enum(['ATTENDING', 'DECLINED', 'UNDECIDED', ''])
        .refine((status) => status !== '', { error: 'chooseAnswer' satisfies ErrorCode }),
      members: z.array(
        z.object({
          guestId: z.string(),
          name: z.string(),
          status: z.enum(['ATTENDING', 'DECLINED', 'UNDECIDED', '']),
          dietary: z.array(z.string()),
          dietaryNotes: tooLong(LIMITS.dietaryNotes),
        }),
      ),
      party: z.array(
        z.object({
          firstName: tooLong(LIMITS.name).refine((name) => name.trim() !== '', {
            error: 'firstName' satisfies ErrorCode,
          }),
          lastName: tooLong(LIMITS.name),
        }),
      ),
      attribution: z.enum(['', 'SIDE_A', 'SIDE_B', 'SHARED']),
      dietary: z.array(z.string()),
      dietaryNotes: tooLong(LIMITS.dietaryNotes),
      drinkPreference: z.string(),
      songRequest: tooLong(LIMITS.song),
      message: tooLong(LIMITS.message),
      answers: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
    })
    .superRefine((values, context) => {
      if (values.status !== 'ATTENDING') return;
      for (const question of answerable) {
        const value = values.answers[question.id];
        const limit = questionLimit(question);
        if (question.required && !isAnswered(value)) {
          context.addIssue({
            code: 'custom',
            path: ['answers', question.id],
            message: 'required' satisfies ErrorCode,
          });
        } else if (limit && typeof value === 'string' && value.length > limit) {
          context.addIssue({
            code: 'custom',
            path: ['answers', question.id],
            message: 'tooLong' satisfies ErrorCode,
          });
        }
      }
    });
}

function formToPayload(question: RsvpQuestion, value: AnswerValue): AnswerPayload | undefined {
  switch (question.type) {
    case 'BOOLEAN':
      return typeof value === 'string' ? FORM_BOOLEAN[value] : undefined;
    case 'SINGLE_CHOICE':
      return typeof value === 'string' && value !== '' ? Number(value) : undefined;
    case 'MULTI_CHOICE':
      return Array.isArray(value) ? value.map(Number) : undefined;
    default:
      return typeof value === 'string' ? value : undefined;
  }
}

function isSame(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Each household member whose answer, needs or notes changed; the rest keep theirs (API.md §4). */
function memberAnswers(values: ReplyFormValues, initial: ReplyFormValues, status: ReplyStatus) {
  return values.members.flatMap((member, index) => {
    const before = initial.members[index];
    const effective = member.status || status;
    const isDietaryChanged = !isSame(member.dietary, before?.dietary);
    const isNotesChanged = member.dietaryNotes !== before?.dietaryNotes;
    if (effective === before?.status && !isDietaryChanged && !isNotesChanged) return [];
    return [
      {
        guestId: member.guestId,
        status: effective,
        ...(isDietaryChanged ? { dietary: member.dietary } : {}),
        ...(isNotesChanged ? { dietaryNotes: member.dietaryNotes } : {}),
      },
    ];
  });
}

function changedAnswers(
  values: ReplyFormValues,
  initial: ReplyFormValues,
  questions: readonly RsvpQuestion[],
) {
  return answerableQuestions(questions).flatMap((question) => {
    const value = values.answers[question.id] ?? '';
    if (isSame(value, initial.answers[question.id] ?? '')) return [];
    const payload = formToPayload(question, value);
    return payload === undefined ? [] : [{ questionId: question.id, value: payload }];
  });
}

/** The respondent's own details: only when attending, and only what changed. */
function attendingDetails(values: ReplyFormValues, initial: ReplyFormValues) {
  const party = values.party
    .filter((row) => row.firstName.trim())
    .map((row) => ({
      firstName: row.firstName.trim(),
      ...(row.lastName.trim() ? { lastName: row.lastName.trim() } : {}),
    }));
  return {
    ...(values.attribution ? { attribution: values.attribution } : {}),
    ...(party.length > 0 ? { party } : {}),
    ...(isSame(values.dietary, initial.dietary) ? {} : { dietary: values.dietary }),
    ...(values.dietaryNotes === initial.dietaryNotes ? {} : { dietaryNotes: values.dietaryNotes }),
    ...(values.drinkPreference === initial.drinkPreference
      ? {}
      : { drinkPreference: values.drinkPreference }),
    ...(values.songRequest === initial.songRequest ? {} : { songRequest: values.songRequest }),
  };
}

/**
 * What is sent: the answer always, and otherwise only what changed, because omitted fields keep
 * their value and a resubmission edits rather than duplicates (docs/API.md §4). Details asked only
 * of attending guests are sent only when attending.
 */
export function buildPayload(
  values: ReplyFormValues,
  initial: ReplyFormValues,
  questions: readonly RsvpQuestion[],
): SubmitReplyBody {
  if (!values.status) {
    throw new Error('A reply needs an answer; the schema checks this first');
  }
  const status = values.status;
  const members = memberAnswers(values, initial, status);
  const answers = status === 'ATTENDING' ? changedAnswers(values, initial, questions) : [];
  return {
    status,
    ...(status === 'ATTENDING' ? attendingDetails(values, initial) : {}),
    ...(members.length > 0 ? { members } : {}),
    ...(values.message === initial.message ? {} : { message: values.message }),
    ...(answers.length > 0 ? { answers } : {}),
  };
}

/** Everyone coming, the respondent first, from what the form will send. */
export function attendingNames(values: ReplyFormValues, respondent: string): string[] {
  if (!values.status) return [];
  const status = values.status;
  const members = values.members
    .filter((member) => (member.status || status) === 'ATTENDING')
    .map((member) => member.name);
  const party =
    status === 'ATTENDING'
      ? values.party
          .filter((row) => row.firstName.trim())
          .map((row) => `${row.firstName.trim()} ${row.lastName.trim()}`.trim())
      : [];
  return [...(status === 'ATTENDING' ? [respondent] : []), ...members, ...party];
}
