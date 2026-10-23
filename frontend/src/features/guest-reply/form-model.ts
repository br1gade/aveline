import { z } from 'zod';

import type { RsvpQuestion } from '@/features/invitation-renderer';

import { LIMITS } from './options';
import type { ReplyRecord, ReplyStatus, SavedStatus } from './types';

/**
 * The reply form's values, how they start from the saved reply, and how they are checked. What
 * is sent is in payload.ts. Kept apart from the components so the rules are tested on their own.
 */

/** Text, a position, or positions, as form inputs hold them: '' is unanswered. */
export type AnswerValue = string | string[];
export type Answers = Record<string, AnswerValue>;

export interface MemberValues {
  guestId: string;
  name: string;
  /** '' follows the respondent's answer until this person is answered for (spec §6.1a). */
  status: ReplyStatus | '';
  dietary: string[];
  dietaryNotes: string;
  /** Their own answers to the host's questions: each person chooses their own meal. */
  answers: Answers;
}

/** Someone added on this reply. They answer for themselves, with the respondent's status. */
export interface PartyValues {
  firstName: string;
  lastName: string;
  dietary: string[];
  dietaryNotes: string;
  answers: Answers;
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
  answers: Answers;
}

/** SIGNATURE questions cannot be answered yet, so they are never shown (PD-23). */
export function answerableQuestions(questions: readonly RsvpQuestion[]): RsvpQuestion[] {
  return questions.filter((question) => question.type !== 'SIGNATURE');
}

export function fullName(person: { firstName: string; lastName: string | null }): string {
  return [person.firstName, person.lastName].filter(Boolean).join(' ');
}

function booleanToForm(value: unknown): AnswerValue {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return '';
}

/** A saved answer as its input holds it; `undefined` gives the question's empty value. */
export function savedToForm(question: RsvpQuestion, value: unknown): AnswerValue {
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

function answersFrom(
  questions: readonly RsvpQuestion[],
  saved: ReadonlyMap<string, unknown>,
): Answers {
  return Object.fromEntries(
    answerableQuestions(questions).map((question) => [
      question.id,
      savedToForm(question, saved.get(question.id)),
    ]),
  );
}

/** A new row in "Add a guest": a name, and their own answers, all empty. */
export function newPartyRow(questions: readonly RsvpQuestion[]): PartyValues {
  return {
    firstName: '',
    lastName: '',
    dietary: [],
    dietaryNotes: '',
    answers: answersFrom(questions, new Map()),
  };
}

function asFormStatus(status: SavedStatus): ReplyStatus | '' {
  return status === 'PENDING' ? '' : status;
}

/**
 * The form as the saved reply leaves it. A first reply starts with nothing chosen. Members' own
 * answers start empty: GET …/rsvp does not return them (FR-21), and an earlier answer still
 * counts on the server, so leaving one empty changes nothing.
 */
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
      answers: answersFrom(questions, new Map()),
    })),
    party: [],
    attribution: '',
    dietary: rsvp.dietary ?? [],
    dietaryNotes: rsvp.dietaryNotes ?? '',
    drinkPreference: rsvp.drinkPreference ?? '',
    songRequest: rsvp.songRequest ?? '',
    message: rsvp.message ?? '',
    answers: answersFrom(questions, saved),
  };
}

export function isAnswered(value: AnswerValue | undefined): boolean {
  return Array.isArray(value) ? value.length > 0 : Boolean(value?.trim());
}

/** The codes the form's messages are looked up by (`reply:errors.*`). */
export type ErrorCode = 'chooseAnswer' | 'firstName' | 'tooLong' | 'required';

const tooLong = (limit: number) => z.string().max(limit, { error: 'tooLong' satisfies ErrorCode });
const answersShape = z.record(z.string(), z.union([z.string(), z.array(z.string())]));

function questionLimit(question: RsvpQuestion): number | undefined {
  if (question.type === 'TEXT') return LIMITS.text;
  if (question.type === 'LONG_TEXT') return LIMITS.longText;
  return undefined;
}

interface AnswerCheck {
  questions: readonly RsvpQuestion[];
  answers: Answers;
  path: Array<string | number>;
  /** Whether this person must answer the required questions here. */
  isBound: boolean;
}

function answerIssues({ questions, answers, path, isBound }: AnswerCheck) {
  return questions.flatMap((question) => {
    const value = answers[question.id];
    const limit = questionLimit(question);
    const at = [...path, 'answers', question.id];
    if (isBound && question.required && !isAnswered(value)) {
      return [{ path: at, message: 'required' satisfies ErrorCode }];
    }
    if (limit && typeof value === 'string' && value.length > limit) {
      return [{ path: at, message: 'tooLong' satisfies ErrorCode }];
    }
    return [];
  });
}

export interface SchemaContext {
  questions: readonly RsvpQuestion[];
  /**
   * Members who have never answered. Only for them can the form know a required question is
   * unanswered; for the rest the server checks, counting their earlier answers.
   */
  neverAnswered: ReadonlySet<string>;
}

const valuesShape = z.object({
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
      answers: answersShape,
    }),
  ),
  party: z.array(
    z.object({
      firstName: tooLong(LIMITS.name),
      lastName: tooLong(LIMITS.name),
      dietary: z.array(z.string()),
      dietaryNotes: tooLong(LIMITS.dietaryNotes),
      answers: answersShape,
    }),
  ),
  attribution: z.enum(['', 'SIDE_A', 'SIDE_B', 'SHARED']),
  dietary: z.array(z.string()),
  dietaryNotes: tooLong(LIMITS.dietaryNotes),
  drinkPreference: tooLong(LIMITS.drink),
  songRequest: tooLong(LIMITS.song),
  message: tooLong(LIMITS.message),
  answers: answersShape,
});

/**
 * Every set of answers on the form: the respondent's, each member's and each added guest's. A
 * required question binds everyone who is coming (docs/API.md §4); added guests come with the
 * respondent, so they are bound when the respondent attends.
 */
function allAnswerIssues(values: z.infer<typeof valuesShape>, context: SchemaContext) {
  const questions = answerableQuestions(context.questions);
  const isAttending = values.status === 'ATTENDING';
  const memberIssues = values.members.flatMap((member, index) =>
    answerIssues({
      questions,
      answers: member.answers,
      path: ['members', index],
      isBound:
        (member.status || values.status) === 'ATTENDING' &&
        context.neverAnswered.has(member.guestId),
    }),
  );
  // Added guests are shown, and sent, only while the respondent is coming: a row left behind by
  // switching to "declining" must not block the reply from a field the guest can no longer see.
  const partyIssues = isAttending
    ? values.party.flatMap((row, index) => [
        ...(row.firstName.trim()
          ? []
          : [{ path: ['party', index, 'firstName'], message: 'firstName' satisfies ErrorCode }]),
        ...answerIssues({ questions, answers: row.answers, path: ['party', index], isBound: true }),
      ])
    : [];
  return [
    ...answerIssues({ questions, answers: values.answers, path: [], isBound: isAttending }),
    ...memberIssues,
    ...partyIssues,
  ];
}

/**
 * The checks a guest can fix before sending. The server stays the authority: whatever it refuses
 * maps onto the same fields (server-errors.ts).
 */
export function replySchema(context: SchemaContext) {
  return valuesShape.superRefine((values, refinement) => {
    for (const issue of allAnswerIssues(values, context)) {
      refinement.addIssue({ code: 'custom', ...issue });
    }
  });
}

/** Members who have never answered, from the saved reply. */
export function neverAnswered(record: ReplyRecord): Set<string> {
  return new Set(
    record.household.members
      .filter((member) => member.status === 'PENDING')
      .map((member) => member.id),
  );
}
