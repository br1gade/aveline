/**
 * What a vendor may see.
 *
 * A brief is assembled from named sections, and a booking lists exactly the
 * sections that vendor gets. The vocabulary is deliberately its own rather
 * than reusing the staff permission names: a caterer needs the headcount and
 * the dietary requirements but has no business reading the playlist, and
 * `operations:read` cannot express that difference.
 *
 * Adding a section is adding a row here and a builder in the service. Nothing
 * outside this list can ever be exposed, because the assembler iterates the
 * list rather than the request.
 */
export const BRIEF_SECTIONS = [
  'headcount',
  'catering',
  'bar',
  'playlist',
  'timeline',
  'seating',
  'households',
  'contacts',
] as const;

export type BriefSection = (typeof BRIEF_SECTIONS)[number];

/** What each section is for, so a host choosing scopes sees plain language. */
export const BRIEF_SECTION_PURPOSE: Record<BriefSection, string> = {
  headcount: 'Confirmed headcount by side',
  catering: 'Covers and dietary requirements',
  bar: 'Drink preferences as quantities',
  playlist: 'Requested songs',
  timeline: 'Running order and access times',
  seating: 'Tables, capacities and who sits where',
  households: 'Guests grouped by household, for formal photographs',
  contacts: 'Guest emails and phone numbers',
};

/** The usual scope set for each kind of vendor, offered as a starting point. */
export const SUGGESTED_SCOPES: Record<string, BriefSection[]> = {
  CATERING: ['headcount', 'catering', 'timeline'],
  BAR: ['headcount', 'bar', 'timeline'],
  MUSIC: ['playlist', 'timeline'],
  VENUE: ['headcount', 'seating', 'timeline'],
  PHOTOGRAPHY: ['timeline', 'households'],
  VIDEOGRAPHY: ['timeline', 'households'],
  DECOR: ['seating', 'timeline'],
  PRINT: ['households'],
  OTHER: ['timeline'],
};

export function isBriefSection(value: string): value is BriefSection {
  return (BRIEF_SECTIONS as readonly string[]).includes(value);
}

/**
 * The sections this booking grants, in a fixed order and without duplicates.
 *
 * Unknown scopes are dropped rather than rejected: a scope removed from the
 * product in a later release must not make an existing brief unreadable, and
 * dropping it can only ever narrow what a vendor sees.
 */
export function sectionsFor(scopes: readonly string[]): BriefSection[] {
  const granted = new Set(scopes.filter(isBriefSection));
  return BRIEF_SECTIONS.filter((section) => granted.has(section));
}
