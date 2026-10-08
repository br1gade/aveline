import { mergeTranslations } from './translated-content';

describe('mergeTranslations', () => {
  const current = { hy: { title: 'Բարև' }, en: { title: 'Hello' } };

  it('replaces the language sent and keeps the rest', () => {
    expect(mergeTranslations(current, { en: { title: 'Welcome' } })).toEqual({
      hy: { title: 'Բարև' },
      en: { title: 'Welcome' },
    });
  });

  it('adds a language the content did not have', () => {
    expect(mergeTranslations(current, { ru: { title: 'Привет' } })).toHaveProperty('ru', { title: 'Привет' });
  });

  it('removes a language sent as null', () => {
    expect(mergeTranslations(current, { en: null })).toEqual({ hy: { title: 'Բարև' } });
  });

  it('starts from nothing when there was no content', () => {
    expect(mergeTranslations(null, { hy: { title: 'Բարև' } })).toEqual({ hy: { title: 'Բարև' } });
  });

  it('does not change the content it was given', () => {
    mergeTranslations(current, { en: null });
    expect(current.en).toEqual({ title: 'Hello' });
  });
});
