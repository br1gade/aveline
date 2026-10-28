import type { BuiltInField, RsvpFieldConfig, RsvpQuestion } from '@/features/invitation-renderer';

import {
  effectiveVenues,
  memberStatus,
  respondentStatus,
  venueAttendance,
  type VenueAnswers,
} from './attendance';
import {
  answerableQuestions,
  isAnswered,
  type AnswerValue,
  type Answers,
  type MemberValues,
  type PartyValues,
  type ReplyFormValues,
} from './form-model';
import { agreementAnswers, pendingAgreements, type SignatureContext } from './signatures';
import type { AnswerPayload, ReplyStatus, SubmitReplyBody } from './types';

/** What the payload needs besides the form: the questions and how the invitation asks them. */
export interface PayloadContext {
  questions: readonly RsvpQuestion[];
  field: (field: BuiltInField) => RsvpFieldConfig;
  /** The language to store as the guest's, when they switched the page to it. */
  locale?: string | undefined;
  /**
   * The revision the reply was read at, sent with every reply so a change of mode meanwhile is
   * refused rather than misread; and the venues to answer in PER_VENUE (none in EVENT_WIDE).
   */
  attendance: { revision: number; venueIds: readonly string[] };
  /** The statements to agree to, and who already has (design PD-52). */
  signatures?: SignatureContext | undefined;
}

interface AnswerEntry {
  questionId: string;
  value: AnswerPayload;
}

/**
 * The respondent's answer, which the others on the form follow where they have none, and the
 * agreements this reply gives, by person (a guest id, or `party.<index>`).
 */
interface Respondent {
  status: ReplyStatus;
  venues: VenueAnswers;
  agreements: ReadonlyMap<string, AnswerEntry[]>;
}

/** Everyone's agreements on this reply; none while the invitation has no statement. */
function agreementsOf(values: ReplyFormValues, context: PayloadContext) {
  const { signatures } = context;
  if (!signatures) return new Map<string, AnswerEntry[]>();
  const pending = pendingAgreements(values, signatures, context.attendance.venueIds);
  return agreementAnswers(pending, signatures.signer);
}

/** One answer in EVENT_WIDE; each venue's in PER_VENUE, where `status` is refused. */
function attendanceOf(status: ReplyStatus, venues: VenueAnswers, context: PayloadContext) {
  const { venueIds } = context.attendance;
  return venueIds.length > 0 ? { venueAttendance: venueAttendance(venues, venueIds) } : { status };
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

/** Whether a member's attendance differs from what was saved. A pending venue always differs. */
function isAttendanceChanged(
  effective: ReplyStatus,
  venues: VenueAnswers,
  before: MemberValues | undefined,
  context: PayloadContext,
): boolean {
  if (context.attendance.venueIds.length === 0) return effective !== before?.status;
  return !isSame(venues, before?.venues ?? {});
}

/**
 * A household member, when anything about them changed. In PER_VENUE every venue is sent, theirs
 * or the respondent's, since nobody follows on the server. Their own answers go only while they
 * are coming: the questions are not shown otherwise.
 */
function memberEntry(
  member: MemberValues,
  before: MemberValues | undefined,
  respondent: Respondent,
  context: PayloadContext,
) {
  const { venueIds } = context.attendance;
  const effective = memberStatus(member, respondent, venueIds);
  if (!effective) return [];
  const venues = effectiveVenues(member.venues, respondent.venues, venueIds);
  const isComing = effective === 'ATTENDING';
  const answers: AnswerEntry[] = isComing
    ? [
        ...changedAnswers(member.answers, before?.answers, context.questions),
        ...(respondent.agreements.get(member.guestId) ?? []),
      ]
    : [];
  const dietary = isComing ? dietaryChanges(member, before, context) : {};
  const isChanged =
    isAttendanceChanged(effective, venues, before, context) ||
    answers.length > 0 ||
    Object.keys(dietary).length > 0;
  if (!isChanged) return [];
  return [
    {
      guestId: member.guestId,
      ...attendanceOf(effective, venues, context),
      ...dietary,
      ...(answers.length > 0 ? { answers } : {}),
    },
  ];
}

/**
 * A guest added on this reply, with what they answered for themselves. They come where the
 * respondent comes: in EVENT_WIDE the server applies that; in PER_VENUE it must be sent.
 */
function partyEntry(
  row: PartyValues,
  index: number,
  respondent: Respondent,
  context: PayloadContext,
) {
  const firstName = row.firstName.trim();
  if (!firstName) return [];
  const answers: AnswerEntry[] = [
    ...changedAnswers(row.answers, undefined, context.questions).filter((answer) =>
      isAnswered(row.answers[answer.questionId]),
    ),
    ...(respondent.agreements.get(`party.${index}`) ?? []),
  ];
  const { venueIds } = context.attendance;
  return [
    {
      firstName,
      ...(row.lastName.trim() ? { lastName: row.lastName.trim() } : {}),
      ...(venueIds.length > 0
        ? { venueAttendance: venueAttendance(respondent.venues, venueIds) }
        : {}),
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
  respondent: Respondent,
  context: PayloadContext,
) {
  const party = values.party.flatMap((row, index) => partyEntry(row, index, respondent, context));
  const own = context.signatures?.signer.guestId;
  const answers: AnswerEntry[] = [
    ...changedAnswers(values.answers, initial.answers, context.questions),
    ...((own && respondent.agreements.get(own)) || []),
  ];
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
 * What is sent: the answer and the attendance revision always, and otherwise only what changed,
 * because omitted fields keep their value and a resubmission edits rather than duplicates
 * (docs/API.md §4). A built-in question the invitation does not ask is never sent: the server
 * refuses it.
 */
export function buildPayload(
  values: ReplyFormValues,
  initial: ReplyFormValues,
  context: PayloadContext,
): SubmitReplyBody {
  const status = respondentStatus(values, context.attendance.venueIds);
  if (!status) {
    throw new Error('A reply needs an answer; the schema checks this first');
  }
  const respondent: Respondent = {
    status,
    venues: values.venues,
    agreements: agreementsOf(values, context),
  };
  const members = values.members.flatMap((member, index) =>
    memberEntry(member, initial.members[index], respondent, context),
  );
  return {
    ...attendanceOf(status, values.venues, context),
    attendanceRevision: context.attendance.revision,
    ...(status === 'ATTENDING' ? attendingDetails(values, initial, respondent, context) : {}),
    ...(members.length > 0 ? { members } : {}),
    ...changedField('message', values.message, initial.message, context),
    ...(context.locale ? { locale: context.locale } : {}),
  };
}

/** Everyone coming, the respondent first, from what the form will send. */
export function attendingNames(
  values: ReplyFormValues,
  respondent: string,
  venueIds: readonly string[],
): string[] {
  const status = respondentStatus(values, venueIds);
  if (!status) return [];
  const members = values.members
    .filter((member) => memberStatus(member, values, venueIds) === 'ATTENDING')
    .map((member) => member.name);
  const party =
    status === 'ATTENDING'
      ? values.party
          .filter((row) => row.firstName.trim())
          .map((row) => `${row.firstName.trim()} ${row.lastName.trim()}`.trim())
      : [];
  return [...(status === 'ATTENDING' ? [respondent] : []), ...members, ...party];
}
