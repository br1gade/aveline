import type { Invitation } from '@/features/invitation-renderer';

import { memberStatus, respondentStatus } from './attendance';
import type { ReplyFormValues } from './form-model';

/**
 * Agreeing to the host's statements, the SIGNATURE questions (docs/API.md §11; design PD-52, which
 * replaces PD-23). The respondent always signs, typed or drawn; for anyone else in the household,
 * including guests they add, they declare that they agree on that person's behalf. A required
 * statement binds everyone coming who has not agreed to its current wording already.
 */

/** A statement in its current version, as the page shows it and the API records it. */
export interface Statement {
  questionId: string;
  statementVersionId: string;
  prompt: string;
  required: boolean;
  /** A published language of the event: the one the wording is recorded in. */
  locale: string;
}

export type SignatureMethod = 'TYPED' | 'DRAWN';

export interface AcknowledgementRecord {
  id: string;
  questionId: string;
  statementVersionId: string;
  subjectGuestId: string;
  method: SignatureMethod;
  createdAt: string;
}

export type UploadStatus = 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED';

export interface SignatureUpload {
  id: string;
  status: UploadStatus;
}

/** `GET …/acknowledgements`: the current statements, the household's records, the uploads. */
export interface AcknowledgementsRead {
  statements: Statement[];
  records: AcknowledgementRecord[];
  uploads: SignatureUpload[];
}

/** The form's values for one statement. */
export interface SignatureValues {
  method: SignatureMethod;
  signerName: string;
  isAcknowledged: boolean;
  /** The respondent's declaration that they agree for the others listed. */
  isOnBehalf: boolean;
  /** A READY drawing's id, once uploaded and processed; '' until then. */
  assetId: string;
}

export const EMPTY_SIGNATURE: SignatureValues = {
  method: 'TYPED',
  signerName: '',
  isAcknowledged: false,
  isOnBehalf: false,
  assetId: '',
};

/** Someone coming, who may need to agree: a guest already on the list, or one added now. */
export interface Signee {
  /** The guest's id, or `party.<index>` for a guest added on this reply. */
  key: string;
  guestId: string | null;
  name: string;
}

/** The respondent, who always signs: their own link is the signer's credential. */
export interface Signer {
  guestId: string;
  name: string;
}

/**
 * The statements to agree to. The page's own wording, in its own language, while it is the
 * current version; the acknowledgements read's when the wording has changed since the page loaded.
 */
export function currentStatements(
  invitation: Invitation,
  read: AcknowledgementsRead | null,
): Statement[] {
  const onPage = invitation.rsvpQuestions.flatMap((question) =>
    question.type === 'SIGNATURE' && question.statementVersionId
      ? [
          {
            questionId: question.id,
            statementVersionId: question.statementVersionId,
            prompt: question.prompt ?? '',
            required: question.required,
            locale: invitation.locale,
          },
        ]
      : [],
  );
  if (!read) return onPage;
  return read.statements.map((current) => {
    const page = onPage.find((statement) => statement.questionId === current.questionId);
    return page?.statementVersionId === current.statementVersionId ? page : current;
  });
}

/** Who already agreed to each statement's current wording, by its question. */
export function coveredGuests(
  statements: readonly Statement[],
  records: readonly AcknowledgementRecord[],
): Map<string, Set<string>> {
  return new Map(
    statements.map((statement) => [
      statement.questionId,
      new Set(
        records
          .filter((record) => record.statementVersionId === statement.statementVersionId)
          .map((record) => record.subjectGuestId),
      ),
    ]),
  );
}

/** Everyone coming on this reply: the respondent, members coming, and guests added now. */
export function attendingPeople(
  values: ReplyFormValues,
  signer: Signer,
  venueIds: readonly string[],
): Signee[] {
  const isComing = respondentStatus(values, venueIds) === 'ATTENDING';
  const members = values.members
    .filter((member) => memberStatus(member, values, venueIds) === 'ATTENDING')
    .map(({ guestId, name }) => ({ key: guestId, guestId, name }));
  const party = isComing
    ? values.party.flatMap((row, index) =>
        row.firstName.trim()
          ? [{ key: `party.${index}`, guestId: null, name: row.firstName.trim() }]
          : [],
      )
    : [];
  const self = isComing
    ? [{ key: signer.guestId, guestId: signer.guestId, name: signer.name }]
    : [];
  return [...self, ...members, ...party];
}

/** Those coming who have not agreed to this wording yet; a guest added now never has. */
export function signeesFor(
  people: readonly Signee[],
  covered: ReadonlySet<string> | undefined,
): Signee[] {
  return people.filter((person) => !person.guestId || !covered?.has(person.guestId));
}

/** What the API records for one person: the signer's own agreement, or on that person's behalf. */
export function signatureAnswer(values: SignatureValues, statement: Statement, isForSelf: boolean) {
  return {
    statementVersionId: statement.statementVersionId,
    method: values.method,
    signerName: values.signerName.trim(),
    isAcknowledged: true as const,
    locale: statement.locale,
    ...(isForSelf ? {} : { isRepresentative: true }),
    ...(values.method === 'DRAWN' ? { assetId: values.assetId } : {}),
  };
}

export type SignatureAnswerValue = ReturnType<typeof signatureAnswer>;

/** The longest signer's name the API takes. */
export const SIGNER_NAME_LIMIT = 200;

/** What the form knows about the statements besides its own values. */
export interface SignatureContext {
  statements: readonly Statement[];
  /** Who already agreed to each statement's current wording, by question. */
  covered: ReadonlyMap<string, ReadonlySet<string>>;
  signer: Signer;
}

/** A statement this reply agrees to, and for whom. */
export interface Agreement {
  statement: Statement;
  values: SignatureValues;
  signees: Signee[];
}

/**
 * The statements with someone left to agree, and the guest's answers for each. A required one is
 * listed whether agreed or not, so the form can ask; an optional one only once agreed to.
 */
export function pendingAgreements(
  values: ReplyFormValues,
  context: SignatureContext,
  venueIds: readonly string[],
): Agreement[] {
  const people = attendingPeople(values, context.signer, venueIds);
  return context.statements.flatMap((statement) => {
    const signees = signeesFor(people, context.covered.get(statement.questionId));
    const own = values.signatures[statement.questionId] ?? EMPTY_SIGNATURE;
    const isAsked = statement.required || own.isAcknowledged;
    return signees.length > 0 && isAsked ? [{ statement, values: own, signees }] : [];
  });
}

export type SignatureCode = 'agree' | 'signerName' | 'tooLong' | 'drawing' | 'onBehalf';

/** What one statement still needs before the reply can go. */
function agreementIssues({ statement, values, signees }: Agreement, signer: Signer) {
  const at = (field: keyof SignatureValues, message: SignatureCode) => ({
    path: ['signatures', statement.questionId, field],
    message,
  });
  if (!values.isAcknowledged) return [at('isAcknowledged', 'agree')];
  const name = values.signerName.trim();
  const isForOthers = signees.some((person) => person.guestId !== signer.guestId);
  return [
    ...(name ? [] : [at('signerName', 'signerName')]),
    ...(name.length > SIGNER_NAME_LIMIT ? [at('signerName', 'tooLong')] : []),
    ...(values.method === 'DRAWN' && !values.assetId ? [at('assetId', 'drawing')] : []),
    ...(isForOthers && !values.isOnBehalf ? [at('isOnBehalf', 'onBehalf')] : []),
  ];
}

export function signatureIssues(
  values: ReplyFormValues,
  context: SignatureContext,
  venueIds: readonly string[],
) {
  return pendingAgreements(values, context, venueIds).flatMap((agreement) =>
    agreementIssues(agreement, context.signer),
  );
}

/** Each person's agreements, by signee key, ready to go into their `answers`. */
export function agreementAnswers(
  agreements: readonly Agreement[],
  signer: Signer,
): Map<string, Array<{ questionId: string; value: SignatureAnswerValue }>> {
  const byPerson = new Map<string, Array<{ questionId: string; value: SignatureAnswerValue }>>();
  for (const { statement, values, signees } of agreements) {
    if (!values.isAcknowledged) continue;
    for (const person of signees) {
      const value = signatureAnswer(values, statement, person.guestId === signer.guestId);
      byPerson.set(person.key, [
        ...(byPerson.get(person.key) ?? []),
        { questionId: statement.questionId, value },
      ]);
    }
  }
  return byPerson;
}
