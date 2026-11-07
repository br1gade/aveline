import { describe, expect, it } from 'vitest';

import { defaultFileLanguage, FILE_LANGUAGES } from './languages';

describe('the language a file is made in', () => {
  it('offers the four languages the API makes files in', () => {
    expect(FILE_LANGUAGES).toEqual(['hy', 'ru', 'en', 'fr']);
  });

  it('starts at the event’s own language, as the backend would', () => {
    expect(defaultFileLanguage('hy', 'en')).toBe('hy');
    expect(defaultFileLanguage('ru', 'fr')).toBe('ru');
  });

  it('reads a region tag as its language', () => {
    expect(defaultFileLanguage('en-GB', 'hy')).toBe('en');
  });

  it('starts at the page’s language when the event’s is not one a file can be made in', () => {
    expect(defaultFileLanguage('de', 'fr')).toBe('fr');
    expect(defaultFileLanguage('', 'hy')).toBe('hy');
  });
});
