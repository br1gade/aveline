import sansArmenian from '@fontsource-variable/noto-sans-armenian/files/noto-sans-armenian-armenian-wght-normal.woff2?url';
import sansLatin from '@fontsource-variable/noto-sans-armenian/files/noto-sans-armenian-latin-wght-normal.woff2?url';
import sansCyrillic from '@fontsource-variable/noto-sans/files/noto-sans-cyrillic-wght-normal.woff2?url';
import serifArmenian from '@fontsource-variable/noto-serif-armenian/files/noto-serif-armenian-armenian-wght-normal.woff2?url';
import serifLatin from '@fontsource-variable/noto-serif-armenian/files/noto-serif-armenian-latin-wght-normal.woff2?url';
import serifCyrillic from '@fontsource-variable/noto-serif/files/noto-serif-cyrillic-wght-normal.woff2?url';
import { preload } from 'react-dom';

/**
 * The first words a guest reads shouldn't wait for their font: the serif of the names and the sans
 * of the page, in the page's script (ARCHITECTURE §8). The stacks put the Armenian family first,
 * which also supplies Latin, and base Noto gives Cyrillic. `?url` is the file the stylesheet names,
 * so it is one download. Anything else on the page loads as it is needed.
 */
const LATIN = [serifLatin, sansLatin];

const BY_LANGUAGE: Readonly<Record<string, readonly string[]>> = {
  hy: [serifArmenian, sansArmenian],
  ru: [serifCyrillic, sansCyrillic],
  en: LATIN,
  fr: LATIN,
};

export function fontsToPreload(language: string): readonly string[] {
  return BY_LANGUAGE[language] ?? LATIN;
}

export function preloadFonts(language: string): void {
  for (const href of fontsToPreload(language)) {
    preload(href, { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
  }
}
