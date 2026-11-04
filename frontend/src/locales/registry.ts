/**
 * The interface strings loaded so far. Each i18next instance reads this one object, so a route's
 * strings count as soon as its module has loaded, which React Router sees to before rendering it.
 * A guest's phone so never downloads the organizer app's words (ARCHITECTURE §8).
 */
type Bundle = Record<string, object>;

export const strings: Record<string, Bundle> = { en: {}, fr: {}, hy: {}, ru: {} };

export function addStrings(bundles: Record<string, Bundle>): void {
  for (const [language, bundle] of Object.entries(bundles)) {
    Object.assign((strings[language] ??= {}), bundle);
  }
}
