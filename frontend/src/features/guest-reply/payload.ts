import type { BuiltInField, RsvpFieldConfig, RsvpQuestion } from '@/features/invitation-renderer';

import {
  answerableQuestions,
  isAnswered,
  type AnswerValue,
  type Answers,
  type MemberValues,
  type PartyValues,
  type ReplyFormValues,
} from './form-model';
import type { AnswerPayload, ReplyStatus, SubmitReplyBody } from './types';

/** What the payload needs besides the form: the questions and how the invitation asks them. */
export interface PayloadContext {
  questions: readonly RsvpQuestion[];
  field: (field: BuiltInField) => RsvpFieldConfig;
  /** The language to store as the guest's, when they switched the page to it. */
  locale?: string | undefined;
}

const FORM_BOOLEAN: Readonly<Record<string, boolean>> = { yes: true, no: false };

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

/** Answers that differ from where they started. A member's and a guest's start empty. */
function changedAnswers(
  answers: Answers,
  before: Answers | undefined,
  questions: readonly RsvpQuestion[],
) {
  return answerableQuestions(questions).flatMap((question) => {
    const value = answers[question.id] ?? '';
    if (isSame(value, before?.[question.id] ?? '')) return [];
    const payload = formToPayload(question, value);
    return payload === undefined ? [] : [{ questionId: question.id, value: payload }];
  });
}

/** Dietary choices and notes, only when the invitation asks, and only what changed. */
function dietaryChanges(
  person: { dietary: string[]; dietaryNotes: string },
  before: { dietary: string[]; dietaryNotes: string } | undefined,
  context: PayloadContext,
) {
  if (!context.field('dietary').isEnabled) return {};
  return {
    ...(isSame(person.dietary, before?.dietary ?? []) ? {} : { dietary: person.dietary }),
    ...(person.dietaryNotes === (before?.dietaryNotes ?? '')
      ? {}
      : { dietaryNotes: person.dietaryNotes }),
  };
}

/**
 * A household member, when anything about them changed. Their own answers go only while they are
 * coming: the questions are not shown otherwise.
 */
function memberEntry(
  member: MemberValues,
  before: MemberValues | undefined,
  status: ReplyStatus,
  context: PayloadContext,
) {
  const effective = member.status || status;
  const answers =
    effective === 'ATTENDING'
      ? changedAnswers(member.answers, before?.answers, context.questions)
      : [];
  const dietary = effective === 'ATTENDING' ? dietaryChanges(member, before, context) : {};
  const isChanged =
    effective !== before?.status || answers.length > 0 || Object.keys(dietary).length > 0;
  if (!isChanged) return [];
  return [
    {
      guestId: member.guestId,
      status: effective,
      ...dietary,
      ...(answers.length > 0 ? { answers } : {}),
    },
  ];
}

/** A guest added on this reply, with what they answered for themselves; status follows ours. */
function partyEntry(row: PartyValues, context: PayloadContext) {
  const firstName = row.firstName.trim();
  if (!firstName) return [];
  const answers = changedAnswers(row.answers, undefined, context.questions).filter((answer) =>
    isAnswered(row.answers[answer.questionId]),
  );
  return [
    {
      firstName,
      ...(row.lastName.trim() ? { lastName: row.lastName.trim() } : {}),
      ...dietaryChanges(row, undefined, context),
      ...(answers.length > 0 ? { answers } : {}),
    },
  ];
}

/** The built-in questions answered in a few words. */
type TextField = 'drinkPreference' | 'songRequest' | 'message';

function changedField(
  field: TextField,
  value: string,
  before: string,
  context: PayloadContext,
): Partial<Record<TextField, string>> {
  return context.field(field).isEnabled && value !== before ? { [field]: value } : {};
}

/** The respondent's own details, asked only of a guest who is coming. */
function attendingDetails(
  values: ReplyFormValues,
  initial: ReplyFormValues,
  context: PayloadContext,
) {
  const party = values.party.flatMap((row) => partyEntry(row, context));
  const answers = changedAnswers(values.answers, initial.answers, context.questions);
  return {
    ...(values.attribution && context.field('attribution').isEnabled
      ? { attribution: values.attribution }
      : {}),
    ...(party.length > 0 ? { party } : {}),
    ...dietaryChanges(values, initial, context),
    ...changedField('drinkPreference', values.drinkPreference, initial.drinkPreference, context),
    ...changedField('songRequest', values.songRequest, initial.songRequest, context),
    ...(answers.length > 0 ? { answers } : {}),
  };
}

/**
 * What is sent: the answer always, and otherwise only what changed, because omitted fields keep
 * their value and a resubmission edits rather than duplicates (docs/API.md §4). A built-in
 * question the invitation does not ask is never sent: the server refuses it.
 */
export function buildPayload(
  values: ReplyFormValues,
  initial: ReplyFormValues,
  context: PayloadContext,
): SubmitReplyBody {
  if (!values.status) {
    throw new Error('A reply needs an answer; the schema checks this first');
  }
  const status = values.status;
  const members = values.members.flatMap((member, index) =>
    memberEntry(member, initial.members[index], status, context),
  );
  return {
    status,
    ...(status === 'ATTENDING' ? attendingDetails(values, initial, context) : {}),
    ...(members.length > 0 ? { members } : {}),
    ...changedField('message', values.message, initial.message, context),
    ...(context.locale ? { locale: context.locale } : {}),
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
