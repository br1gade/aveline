import { isDeliveryGroup, type DeliveryGroup } from '@/features/sending';

import { ANSWERS, type Answer, type Guest, type Household } from './types';

/**
 * The search, the answer filter and the invitation filter, kept in the address so a reload or a
 * shared link keeps them.
 */
export interface GuestFilter {
  query: string;
  answer: Answer | null;
  /** What happened to the household's invitation (design PD-48). */
  invite: DeliveryGroup | null;
}

const SEARCH_PARAM = 'q';
const ANSWER_PARAM = 'answer';
const INVITE_PARAM = 'invite';

function isAnswer(value: string): value is Answer {
  return (ANSWERS as readonly string[]).includes(value);
}

/** An answer the address names in lower case; anything unknown is no filter. */
export function filterFromQuery(params: URLSearchParams): GuestFilter {
  const answer = (params.get(ANSWER_PARAM) ?? '').toUpperCase();
  const invite = params.get(INVITE_PARAM) ?? '';
  return {
    query: params.get(SEARCH_PARAM) ?? '',
    answer: isAnswer(answer) ? answer : null,
    invite: isDeliveryGroup(invite) ? invite : null,
  };
}

/** The address's query with this filter, the rest (the language, say) kept, and blanks left out. */
export function withFilter(params: URLSearchParams, filter: GuestFilter): URLSearchParams {
  const next = new URLSearchParams(params);
  if (filter.answer) next.set(ANSWER_PARAM, filter.answer.toLowerCase());
  else next.delete(ANSWER_PARAM);
  if (filter.invite) next.set(INVITE_PARAM, filter.invite);
  else next.delete(INVITE_PARAM);
  const query = filter.query.trim();
  if (query) next.set(SEARCH_PARAM, query);
  else next.delete(SEARCH_PARAM);
  return next;
}

/** Case and accents ignored, in every script: "Пётр" finds "Петр", "ANI" finds "Ani". */
export function normalizeName(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

interface IndexedHousehold {
  household: Household;
  key: string;
  guests: ReadonlyArray<{ guest: Guest; key: string }>;
}

/** Built once per load, so a keystroke compares strings and normalizes nothing. */
export type HouseholdIndex = readonly IndexedHousehold[];

export function indexHouseholds(households: readonly Household[]): HouseholdIndex {
  return households.map((household) => ({
    household,
    key: normalizeName(household.name),
    guests: household.guests.map((guest) => ({ guest, key: normalizeName(guest.name) })),
  }));
}

/** A household and the guests of it the filter shows. */
export interface VisibleHousehold {
  household: Household;
  guests: readonly Guest[];
}

function visibleGuests(entry: IndexedHousehold, query: string, answer: Answer | null): Guest[] {
  const isHouseholdFound = entry.key.includes(query);
  return entry.guests
    .filter(
      ({ guest, key }) =>
        (isHouseholdFound || key.includes(query)) && (!answer || guest.answer === answer),
    )
    .map(({ guest }) => guest);
}

/** A household's invitation group, from the delivery report; `null` when it does not say. */
export type GroupOf = (householdId: string) => DeliveryGroup | null;

/**
 * The households to show, in the list's own order. A household whose name matches shows all its
 * guests; otherwise only the guests who match. When every guest of a household shows, its own
 * array is passed on, so a memoized household is not drawn again. The invitation filter applies
 * only while there is a report to read it from (`groupOf`).
 */
export function filterHouseholds(
  index: HouseholdIndex,
  filter: GuestFilter,
  groupOf?: GroupOf,
): VisibleHousehold[] {
  const query = normalizeName(filter.query.trim());
  const invite = groupOf ? filter.invite : null;
  if (!query && !filter.answer && !invite) {
    return index.map(({ household }) => ({ household, guests: household.guests }));
  }
  return index.flatMap((entry) => {
    if (invite && groupOf?.(entry.household.id) !== invite) return [];
    const guests = visibleGuests(entry, query, filter.answer);
    if (guests.length === 0) return [];
    const isWhole = guests.length === entry.household.guests.length;
    return [{ household: entry.household, guests: isWhole ? entry.household.guests : guests }];
  });
}
