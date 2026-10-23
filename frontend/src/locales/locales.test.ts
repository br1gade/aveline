import { describe, expect, it } from 'vitest';

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
});
