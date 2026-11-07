import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resources } from '@/locales';

/**
 * Every character the interface writes is in a subset of the self-hosted fonts (ARCHITECTURE §8).
 * The stacks put the Armenian family first and base Noto after it, so a character is covered when
 * either declares it. A character in no subset would fall through to a system font, out of the
 * design (C-6). French was checked this way when it was added (design C-23).
 */
const STACKS = {
  sans: ['noto-sans-armenian', 'noto-sans'],
  serif: ['noto-serif-armenian', 'noto-serif'],
};

/** French letters and punctuation, whether or not a string uses them yet. */
const FRENCH = 'àâæçéèêëîïôœùûüÿÀÂÆÇÉÈÊËÎÏÔŒÙÛÜŸ«»’€  ';

type Range = readonly [number, number];

function unicodeRanges(family: string): Range[] {
  const css = readFileSync(
    join(import.meta.dirname, '../../node_modules/@fontsource-variable', family, 'wght.css'),
    'utf8',
  );
  return [...css.matchAll(/unicode-range:\s*([^;]+);/g)].flatMap((match) =>
    (match[1] ?? '').split(',').map((part): Range => {
      const [start = '0', end = start] = part.trim().replace(/^U\+/i, '').split('-');
      return [parseInt(start, 16), parseInt(end, 16)];
    }),
  );
}

interface Tree {
  [key: string]: string | Tree;
}

function strings(tree: Tree): string[] {
  return Object.values(tree).flatMap((value) =>
    typeof value === 'string' ? [value] : strings(value),
  );
}

function uncovered(text: string, ranges: Range[]): string[] {
  const points = new Set([...text].map((character) => character.codePointAt(0) ?? 0));
  return [...points]
    .filter((point) => !ranges.some(([start, end]) => point >= start && point <= end))
    .map((point) => `U+${point.toString(16).toUpperCase().padStart(4, '0')}`);
}

const everyString = Object.values(resources)
  .flatMap((namespaces) => Object.values(namespaces).flatMap((tree) => strings(tree as Tree)))
  .join('');

describe('fonts', () => {
  it.each(Object.entries(STACKS))('the %s stack covers every interface string', (_, families) => {
    const ranges = families.flatMap(unicodeRanges);
    expect(uncovered(everyString, ranges)).toEqual([]);
  });

  it.each(Object.entries(STACKS))('the %s stack covers French', (_, families) => {
    const ranges = families.flatMap(unicodeRanges);
    expect(uncovered(FRENCH, ranges)).toEqual([]);
  });
});
