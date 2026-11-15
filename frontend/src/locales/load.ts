import { addStrings } from './registry';

/**
 * Which strings a page loads (ARCHITECTURE §8): its group, guest, public or app, and in the browser
 * only the page's language and English, the fallback, rather than all four (audit F-23). A bundle
 * is `bundles/<group>.<language>.ts`. The server and the tests have every language at hand.
 *
 * A group module awaits its load at the top, so a route's strings are there before React Router
 * renders it, on the first page and after any navigation.
 */
export type Group = 'guest' | 'public' | 'app';

const LANGUAGES = ['en', 'fr', 'hy', 'ru'] as const;
const SOURCE = 'en';

interface BundleModule {
  default: Record<string, object>;
}

const bundles = import.meta.glob<BundleModule>('./bundles/*.ts');
const loadedGroups = new Set<Group>();
const loaded = new Set<string>();

async function loadBundle(group: Group, language: string): Promise<void> {
  const name = `${group}.${language}`;
  const load = bundles[`./bundles/${name}.ts`];
  if (loaded.has(name) || !load) return;
  const { default: bundle } = await load();
  addStrings({ [language]: bundle });
  loaded.add(name);
}

/** The server and the tests: every language. A browser: the page's own, and English. */
function languagesHere(): string[] {
  if (import.meta.env.SSR || import.meta.env.MODE === 'test') return [...LANGUAGES];
  const page = document.documentElement.lang;
  return page !== SOURCE && (LANGUAGES as readonly string[]).includes(page)
    ? [SOURCE, page]
    : [SOURCE];
}

export async function loadGroup(group: Group): Promise<void> {
  loadedGroups.add(group);
  await Promise.all(languagesHere().map((language) => loadBundle(group, language)));
}

/** Whether every group loaded so far has its strings in `language`. */
export function hasLanguage(language: string): boolean {
  return [...loadedGroups].every((group) => loaded.has(`${group}.${language}`));
}

/** The strings of every group loaded so far, in a language the page turned to since. */
export async function loadLanguage(language: string): Promise<void> {
  await Promise.all([...loadedGroups].map((group) => loadBundle(group, language)));
}
