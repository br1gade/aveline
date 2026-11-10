import type { Guest } from '@/features/guests';
import type { Question } from '@/features/invitation-design';
import { inLanguage } from '@/features/ticket-sales';

/**
 * Who still has to agree before the door (docs/API.md §11; design PD-93, and PD-155 for the hosts'
 * agreements page). The backend refuses them
 * at check-in and at admission, and says who only then, one at a time; no read says it beforehand.
 * `acknowledgementsRequiredBeforeCheckIn` names statements, not people, and only in a public
 * event's checkout. So **a temporary stand-in** compares the design's required statements with the
 * agreements on record, as `assertRequiredAcknowledgements` does. It is advice: the server decides,
 * and Check in stays live so that someone who has just agreed gets through. Deleted when FR-78 is
 * answered.
 */
export interface RequiredStatement {
  questionId: string;
  /** Only an agreement to this wording counts. */
  versionId: string;
  prompt: Readonly<Record<string, string>>;
}

/** The guest's id, and the wordings they have agreed to. */
export type Agreements = ReadonlyMap<string, ReadonlySet<string>>;

interface AgreementFact {
  subjectGuestId: string;
  statementVersionId: string;
}

export function requiredStatements(questions: readonly Question[]): RequiredStatement[] {
  return questions.flatMap((question) =>
    question.type === 'SIGNATURE' && question.required && question.statementVersionId
      ? [
          {
            questionId: question.id,
            versionId: question.statementVersionId,
            prompt: question.prompt,
          },
        ]
      : [],
  );
}

export function statementWords(
  statement: RequiredStatement,
  language: string,
  fallback: string,
): string | null {
  return inLanguage(statement.prompt, language, fallback);
}

export function mergeNewest(agreements: Agreements, records: readonly AgreementFact[]): Agreements {
  const merged = new Map(agreements);
  for (const { subjectGuestId, statementVersionId } of records) {
    merged.set(
      subjectGuestId,
      new Set([...(merged.get(subjectGuestId) ?? []), statementVersionId]),
    );
  }
  return merged;
}

export function agreementsFrom(records: readonly AgreementFact[]): Agreements {
  return mergeNewest(new Map(), records);
}

export function statementsStillOwed(
  guestId: string,
  statements: readonly RequiredStatement[],
  agreements: Agreements,
): RequiredStatement[] {
  const agreed = agreements.get(guestId);
  return statements.filter((statement) => !agreed?.has(statement.versionId));
}

export interface PersonWhoMustAgree<P = Guest> {
  guest: P;
  owed: RequiredStatement[];
}

/**
 * Those worth telling in advance: coming, not erased and not here yet. `isHere` is the door's own
 * knowledge, which is newer than the list's. The gate binds everyone.
 */
export function peopleWhoMustAgree<P extends { id: string; answer: string; isErased?: boolean }>(
  households: readonly { guests: readonly P[] }[],
  statements: readonly RequiredStatement[],
  agreements: Agreements,
  isHere: (guest: P) => boolean,
): PersonWhoMustAgree<P>[] {
  if (statements.length === 0) return [];
  return households.flatMap(({ guests }) =>
    guests.flatMap((guest) => {
      if (guest.isErased === true || guest.answer !== 'ATTENDING' || isHere(guest)) return [];
      const owed = statementsStillOwed(guest.id, statements, agreements);
      return owed.length > 0 ? [{ guest, owed }] : [];
    }),
  );
}

export interface StillOwed {
  statement: RequiredStatement;
  names: string[];
}

/** The same people, statement by statement, in the design's order; none left out of a statement. */
export function owedByStatement(
  statements: readonly RequiredStatement[],
  people: readonly PersonWhoMustAgree[],
): StillOwed[] {
  return statements.flatMap((statement) => {
    const names = people
      .filter(({ owed }) => owed.some(({ versionId }) => versionId === statement.versionId))
      .map(({ guest }) => guest.name);
    return names.length > 0 ? [{ statement, names }] : [];
  });
}
