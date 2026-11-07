// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const LOCALES = import.meta.dirname;
const ROUTES = join(LOCALES, '../routes');
const LANGUAGES = ['en', 'fr', 'hy', 'ru'];

const source = (path: string) => readFileSync(path, 'utf8');

function namespacesIn(bundle: string, language: string): string[] {
  const named = source(join(LOCALES, `${bundle}.ts`)).matchAll(
    new RegExp(`\\./${language}/([\\w-]+)\\.json`, 'g'),
  );
  return [...named].map((match) => match[1] ?? '').sort();
}

function allNamespaces(language: string): string[] {
  return readdirSync(join(LOCALES, language))
    .map((file) => file.replace(/\.json$/, ''))
    .sort();
}

const routesIn = (folder: string) =>
  readdirSync(join(ROUTES, folder)).filter((file) => /\.tsx$/.test(file) && !/test/.test(file));

const GUEST_PAGES = ['guest-invitation.tsx', 'invitation.tsx'];

describe('the bundles of strings', () => {
  it.each(LANGUAGES)('%s: every namespace is in exactly one', (language) => {
    const bundled = ['guest', 'public', 'app'].flatMap((name) => namespacesIn(name, language));
    expect(bundled.sort()).toEqual(allNamespaces(language));
  });
});

describe('the bundle each page brings', () => {
  it.each(routesIn('public').filter((file) => !GUEST_PAGES.includes(file)))(
    'public/%s brings the public strings',
    (file) => {
      expect(source(join(ROUTES, 'public', file))).toContain("import '@/locales/public';");
    },
  );

  it.each(routesIn('account'))('account/%s brings the app’s strings', (file) => {
    expect(source(join(ROUTES, 'account', file))).toContain("import '@/locales/app';");
  });

  it('the app’s frame brings the app’s strings, for every page in it', () => {
    expect(source(join(ROUTES, 'app/route.tsx'))).toContain("import '@/locales/app';");
  });

  it.each(GUEST_PAGES)('public/%s brings no more than a guest needs', (file) => {
    expect(source(join(ROUTES, 'public', file))).not.toMatch(/@\/locales\/(?:app|public)/);
  });
});

/** What the guest pages render from. Every test loads every bundle, so a render can't catch this. */
const GUEST_SOURCES = [
  'features/invitation-renderer',
  'features/guest-reply',
  'features/gallery',
  'features/guest-agreements',
  'features/guest-name',
  'ui',
  'lib',
];

function namespacesUsedIn(folder: string): string[] {
  const files = readdirSync(join(LOCALES, '..', folder), { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\./.test(file))
    .map((file) => source(join(LOCALES, '..', folder, file)));
  const used = files.flatMap((text) =>
    [...text.matchAll(/useTranslation\(\s*'([\w-]+)'/g)].map((match) => match[1] ?? ''),
  );
  return [...new Set(used)];
}

describe('the words a guest page uses', () => {
  it.each(GUEST_SOURCES)('%s asks only for the guest’s strings', (folder) => {
    const guest = namespacesIn('guest', 'en');
    expect(namespacesUsedIn(folder).filter((name) => !guest.includes(name))).toEqual([]);
  });
});
