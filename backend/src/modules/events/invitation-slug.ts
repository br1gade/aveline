/**
 * The public URL segment an invitation lives at.
 *
 * It is the one piece of the system a guest sees and may read aloud, so it is
 * built from the hosts' names where that is possible. Two constraints make
 * this less obvious than it looks:
 *
 * - **Armenian titles transliterate to nothing.** `Աննա և Դավիթ` contains no
 *   URL-safe characters at all, and a product whose home market writes in
 *   Armenian cannot treat that as the edge case. When nothing survives, the
 *   slug is the event type and a random tail — ugly, but it works, and the
 *   host can be offered a custom one later.
 * - **It has to be unique**, and two couples called Anna and Davit is not a
 *   hypothetical. A short random tail makes a collision unlikely, and the
 *   unique constraint on the column is what actually guarantees it.
 */
const MAX_NAME_LENGTH = 40;

export function invitationSlug(hostsLabel: string, randomTail: string): string {
  const base = slugify(hostsLabel);
  return base.length > 0 ? `${base}-${randomTail}` : `event-${randomTail}`;
}

/**
 * Lower-cases, strips accents, and keeps only what is safe in a URL.
 *
 * Deliberately not a transliteration: guessing that `և` should become `yev`
 * is the kind of cleverness that produces a slug no Armenian speaker
 * recognises. Either the name is already URL-safe or it is replaced wholesale.
 */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    // Strip combining marks left by the decomposition, so "Davít" keeps its d.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_NAME_LENGTH)
    .replace(/-+$/g, '');
}
