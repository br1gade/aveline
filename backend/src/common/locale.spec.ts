import { resolveTranslation } from './locale';

describe('resolveTranslation', () => {
  const content = { hy: 'Բարև', en: 'Hello' };

  it('returns the requested locale', () => {
    expect(resolveTranslation(content, 'en', 'hy')).toBe('Hello');
  });

  it('falls back to the default locale when the request is missing', () => {
    expect(resolveTranslation(content, 'ru', 'hy')).toBe('Բարև');
  });

  it('falls back to any available translation rather than rendering a gap', () => {
    expect(resolveTranslation({ fr: 'Bonjour' }, 'ru', 'hy')).toBe('Bonjour');
  });

  it('returns null for empty or non-object content', () => {
    expect(resolveTranslation(null, 'en', 'hy')).toBeNull();
    expect(resolveTranslation('plain', 'en', 'hy')).toBeNull();
    expect(resolveTranslation({}, 'en', 'hy')).toBeNull();
  });
});
