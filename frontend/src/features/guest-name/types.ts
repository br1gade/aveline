/** A guest's name as the reply read holds it (`GET …/rsvp`'s `guest`). */
export interface SavedName {
  firstName: string;
  lastName: string | null;
}

/** What `PATCH …/g/:guestToken/name` sends: either name may be left out; `null` clears the surname. */
export interface NameBody {
  firstName?: string;
  lastName?: string | null;
}

/**
 * Its answer (docs/API.md §4, "Correct your own name"). Checked against the schema at its call
 * (FR-1).
 */
export interface CorrectedName {
  id: string;
  firstName: string;
  lastName: string | null;
  /** The two joined, as the backend shows them everywhere. */
  name: string;
}
