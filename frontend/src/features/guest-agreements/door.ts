import { signeesFor, type Signee, type Statement } from '@/features/guest-reply';

/**
 * Agreeing before the door (docs/API.md §11, design PD-83): a ticket holder, or any guest coming,
 * agrees from their personal link without replying again. Each statement in its current wording
 * is asked of everyone coming in the household who has not agreed to it yet.
 */
export interface DoorAgreement {
  statement: Statement;
  /** Coming, and not agreed to this wording yet. */
  signees: Signee[];
  /** Coming, and already agreed to it. */
  agreed: Signee[];
}

export function doorAgreements(
  statements: readonly Statement[],
  covered: ReadonlyMap<string, ReadonlySet<string>>,
  people: readonly Signee[],
): DoorAgreement[] {
  return statements.flatMap((statement) => {
    const done = covered.get(statement.questionId);
    const signees = signeesFor(people, done);
    const agreed = people.filter((person) => person.guestId !== null && done?.has(person.guestId));
    return signees.length > 0 ? [{ statement, signees, agreed }] : [];
  });
}

/** Whether the signer agrees for anyone but themselves, which they must declare. */
export function isForOthers(agreement: DoorAgreement, signerId: string): boolean {
  return agreement.signees.some((person) => person.guestId !== signerId);
}
