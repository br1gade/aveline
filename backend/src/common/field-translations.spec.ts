import { EVENT_TRANSLATABLE, translatedField, translationsProblem } from './field-translations';

describe('translationsProblem', () => {
  it('accepts languages with known fields, and null to remove one', () => {
    expect(translationsProblem({ en: { title: 'A & B' }, ru: null }, EVENT_TRANSLATABLE)).toBeNull();
  });

  it.each([
    [{ English: { title: 'x' } }, /not a language code/],
    [{ en: 'A & B' }, /must be an object/],
    [{ en: { motto: 'x' } }, /not translatable/],
    [{ en: { title: 7 } }, /at most 200/],
    [{ en: { title: 'x'.repeat(201) } }, /at most 200/],
  ])('refuses %j', (edit, message) => {
    expect(translationsProblem(edit, EVENT_TRANSLATABLE)).toMatch(message);
  });
});

describe('translatedField', () => {
  const translations = { en: { title: 'The wedding', hostsLabel: '' } };

  it('reads the field in the language', () => {
    expect(translatedField(translations, 'en', 'title')).toBe('The wedding');
  });

  it.each([
    ['ru', 'title'],
    ['en', 'hostsLabel'],
    ['en', 'missing'],
  ])('is undefined for %s.%s, so the original shows', (locale, field) => {
    expect(translatedField(translations, locale, field)).toBeUndefined();
  });

  it('survives content that was never set', () => {
    expect(translatedField(null, 'en', 'title')).toBeUndefined();
  });
});
