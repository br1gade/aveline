/**
 * The household side of an answer: who the plus-ones are, and who may be
 * answered for.
 *
 * A plus-one is matched by name against everyone already in the household, so
 * sending the same form twice — a retry, an edit — names the same people
 * rather than adding them again. Only a name not yet in the household is new.
 */
interface NamedPerson {
  firstName: string;
  lastName?: string | null;
}

export function personKey(person: NamedPerson): string {
  return [person.firstName, person.lastName ?? '']
    .map((part) => part.trim().toLowerCase().replace(/\s+/g, ' '))
    .join('|');
}

/** The plus-ones not already in the household, each once. */
export function newPartyMembers<T extends NamedPerson>(household: NamedPerson[], party: T[]): T[] {
  const known = new Set(household.map(personKey));
  return party.filter((person) => {
    const key = personKey(person);
    if (known.has(key)) return false;
    known.add(key);
    return true;
  });
}

/** Whether these member answers may be given by this respondent — or why not. */
export function membersProblem(
  householdIds: ReadonlySet<string>,
  respondentId: string,
  memberIds: string[],
): string | null {
  const seen = new Set<string>();
  for (const id of memberIds) {
    if (id === respondentId) return 'members: your own answer is the top-level status, not a member entry';
    if (!householdIds.has(id)) return `members: ${id} is not in this household`;
    if (seen.has(id)) return `members: ${id} is answered twice`;
    seen.add(id);
  }
  return null;
}
