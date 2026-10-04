import { negotiateLocale, resolveTranslation } from './locale';

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

/**
 * Found while auditing localization: `?locale=` went straight into the Redis
 * cache key unvalidated, so 50 junk values created 50 cache entries. On a
 * public, unauthenticated endpoint with an LRU eviction policy that lets
 * anyone evict every real entry. The response also reported the junk locale
 * while serving default-language content.
 */
describe('negotiateLocale', () => {
  const available = ['hy', 'ru', 'en'];

  it('honours a locale the event actually publishes', () => {
    expect(negotiateLocale('ru', available, 'hy')).toBe('ru');
  });

  it('falls back to the default rather than echoing an unoffered locale', () => {
    expect(negotiateLocale('de', available, 'hy')).toBe('hy');
  });

  it('falls back to the default when none is requested', () => {
    expect(negotiateLocale(undefined, available, 'hy')).toBe('hy');
  });

  it('matches case-insensitively, since links get typed by hand', () => {
    expect(negotiateLocale('RU', available, 'hy')).toBe('ru');
  });

  it('accepts a region tag for a language the event publishes', () => {
    expect(negotiateLocale('en-GB', available, 'hy')).toBe('en');
  });

  // The whole point: the key space is bounded by what the event publishes.
  it.each([
    'zz1',
    '../../etc/passwd',
    'a'.repeat(500),
    '',
    'hy; DROP TABLE',
  ])('never returns %p, so it cannot become a cache key', (junk) => {
    expect(available).toContain(negotiateLocale(junk, available, 'hy'));
  });

  it('falls back to the default when the event lists no locales', () => {
    expect(negotiateLocale('ru', [], 'hy')).toBe('hy');
  });
});
