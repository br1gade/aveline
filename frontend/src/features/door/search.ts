import { normalizeName, type Guest, type Household } from '@/features/guests';

/** Enough for one name on a phone; a longer search says to type more. */
export const MAX_FOUND = 20;

interface Entry {
  guest: Guest;
  household: Household;
  /** Their name alone, for ranking. */
  nameKey: string;
  /** Their name and their household's, for matching. */
  key: string;
}

/** Built once per read, so a keystroke compares strings and normalizes nothing. */
export type GuestIndex = readonly Entry[];

export function indexGuests(households: readonly Household[]): GuestIndex {
  return households.flatMap((household) => {
    const householdKey = normalizeName(household.name);
    return household.guests
      .filter((guest) => !guest.isErased)
      .map((guest) => {
        const nameKey = normalizeName(guest.name);
        return { guest, household, nameKey, key: `${nameKey} ${householdKey}` };
      });
  });
}

export interface FoundPerson {
  guest: Guest;
  household: Household;
  /** `false` for someone shown only because they share a household with who was searched for. */
  isMatch: boolean;
}

export interface Found {
  people: FoundPerson[];
  /** More matched than are shown. */
  isCapped: boolean;
}

/** Every word typed, anywhere; those whose own name holds the first word come first. */
function ranked(index: GuestIndex, words: readonly string[]): Entry[] {
  const own: Entry[] = [];
  const others: Entry[] = [];
  for (const entry of index) {
    if (!words.every((word) => entry.key.includes(word))) continue;
    (entry.nameKey.includes(words[0] ?? '') ? own : others).push(entry);
  }
  return [...own, ...others];
}

/**
 * Who to show for what was typed (design PD-90): each match, then the rest of their household, who
 * usually arrive with them. Nobody for an empty search, so the whole list is never on screen. One
 * pass over the list, then over the matches' households.
 */
export function findGuests(index: GuestIndex, query: string): Found {
  const words = normalizeName(query).split(/\s+/u).filter(Boolean);
  if (words.length === 0) return { people: [], isCapped: false };
  const matches = ranked(index, words);
  const matchIds = new Set(matches.map(({ guest }) => guest.id));
  const shown = new Set<string>();
  const people: FoundPerson[] = [];
  const add = (guest: Guest, household: Household) => {
    if (shown.has(guest.id) || guest.isErased) return;
    shown.add(guest.id);
    people.push({ guest, household, isMatch: matchIds.has(guest.id) });
  };
  for (const { guest, household } of matches) {
    add(guest, household);
    for (const mate of household.guests) add(mate, household);
  }
  return { people: people.slice(0, MAX_FOUND), isCapped: people.length > MAX_FOUND };
}
