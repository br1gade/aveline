/**
 * Keys for the built-in questions' fixed choices (design PD-60). Guests send the key and the bar
 * and catering sheets count it, so "Wine", "Вино" and "Գինի" are one row; a key removed from the
 * list later shows as itself. The backend takes lowercase letters, digits and dashes, at most 40
 * (`rsvp-fields.ts`), so a key is made from the first label in Latin letters, else numbered by
 * its place, and a saved key is never changed.
 */

const MAX_LENGTH = 40;

/** The first label that gives Latin letters or digits, as a key; `null` when none does. */
export function keyFromLabels(labels: readonly string[]): string | null {
  for (const label of labels) {
    const key = label
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, MAX_LENGTH)
      .replace(/^-+|-+$/g, '');
    if (key) return key;
  }
  return null;
}

function unique(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const ending = `-${suffix}`;
    const key = `${base.slice(0, MAX_LENGTH - ending.length).replace(/-+$/, '')}${ending}`;
    if (!taken.has(key)) return key;
  }
}

/** Each choice's key, in order: its saved one, or a new one unique among them all. */
export function assignKeys(
  choices: ReadonlyArray<{ key: string; labels: readonly string[] }>,
): string[] {
  const taken = new Set(choices.map((choice) => choice.key).filter(Boolean));
  return choices.map((choice, position) => {
    if (choice.key) return choice.key;
    const key = unique(keyFromLabels(choice.labels) ?? `choice-${position + 1}`, taken);
    taken.add(key);
    return key;
  });
}
