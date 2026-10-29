import { describe, expect, it } from 'vitest';

import { LANGUAGES } from '@/lib/i18n';

import { resources } from './index';

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

interface Tree {
  [key: string]: string | Tree;
}

function flatten(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : flatten(value, `${prefix}${key}.`),
  );
}

/** Plural variants differ by language (Russian has few and many); compare their base keys. */
function baseKeys(tree: Tree): string[] {
  return [...new Set(flatten(tree).map((key) => key.replace(PLURAL_SUFFIX, '')))].sort();
}

function strings(tree: Tree): string[] {
  return Object.values(tree).flatMap((value) =>
    typeof value === 'string' ? [value] : strings(value),
  );
}

function pluralForms(tree: Tree): Map<string, Set<string>> {
  const forms = new Map<string, Set<string>>();
  for (const key of flatten(tree)) {
    const match = PLURAL_SUFFIX.exec(key);
    if (match?.[1]) {
      const base = key.replace(PLURAL_SUFFIX, '');
      forms.set(base, (forms.get(base) ?? new Set()).add(match[1]));
    }
  }
  return forms;
}

const languages = Object.keys(resources) as Array<keyof typeof resources>;
const namespaces = Object.keys(resources.en) as Array<keyof (typeof resources)['en']>;

describe('interface strings', () => {
  it('exist for every interface language, and only those', () => {
    expect([...languages].sort()).toEqual([...LANGUAGES].sort());
  });

  it.each(namespaces)('namespace %s has the same keys in every language', (namespace) => {
    const source = baseKeys(resources.en[namespace]);
    for (const language of languages) {
      expect(baseKeys(resources[language][namespace]), language).toEqual(source);
    }
  });

  it.each(namespaces)('namespace %s has every plural form each language needs', (namespace) => {
    for (const language of languages) {
      const required = new Intl.PluralRules(language).resolvedOptions().pluralCategories;
      for (const [base, forms] of pluralForms(resources[language][namespace])) {
        for (const category of required) {
          expect(forms.has(category), `${language} ${namespace}.${base}_${category}`).toBe(true);
        }
      }
    }
  });

  /**
   * French sets a space before ; : ! ? and inside « », and it must not break there: a narrow
   * no-break space (U+202F), or a no-break space (U+00A0) before a colon.
   */
  it.each(namespaces)('namespace %s keeps French spaces unbreakable', (namespace) => {
    const breakable = / [;:!?»]|« /;
    const offending = strings(resources.fr[namespace]).filter((text) => breakable.test(text));
    expect(offending).toEqual([]);
  });
});
