import { invitationSlug, slugify } from './invitation-slug';

describe('slugify', () => {
  it('lower-cases and joins words with hyphens', () => {
    expect(slugify('Anna & Davit')).toBe('anna-davit');
  });

  it('keeps accented Latin letters readable', () => {
    expect(slugify('Davít Müller')).toBe('davit-muller');
  });

  /**
   * The case a product written for Armenia cannot treat as an edge case:
   * Armenian text contains nothing URL-safe, so there is nothing to keep.
   */
  it.each(['Աննա և Դավիթ', 'Հարսանիք', '——', '   ', ''])('yields nothing for %s', (value) => {
    expect(slugify(value)).toBe('');
  });

  it.each([
    { raw: '  Anna   &&&   Davit  ', expected: 'anna-davit' },
    { raw: '---Anna---', expected: 'anna' },
    { raw: 'Anna/Davit', expected: 'anna-davit' },
    { raw: "O'Brien & Sons", expected: 'o-brien-sons' },
  ])('normalises $raw', ({ raw, expected }) => {
    expect(slugify(raw)).toBe(expected);
  });

  it('bounds the length, without leaving a trailing hyphen', () => {
    const slug = slugify('a'.repeat(30) + ' ' + 'b'.repeat(30));

    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('invitationSlug', () => {
  it('reads as the hosts’ names, with a tail for uniqueness', () => {
    expect(invitationSlug('Anna & Davit', 'a1b2c3')).toBe('anna-davit-a1b2c3');
  });

  // Two couples called Anna and Davit is not a hypothetical.
  it('differs for the same names', () => {
    expect(invitationSlug('Anna & Davit', 'a1b2c3')).not.toBe(
      invitationSlug('Anna & Davit', 'd4e5f6'),
    );
  });

  // Ugly but usable beats failing to create the event.
  it('falls back to a generic slug when the name yields nothing', () => {
    expect(invitationSlug('Աննա և Դավիթ', 'a1b2c3')).toBe('event-a1b2c3');
  });

  it.each(['Anna & Davit', 'Աննա և Դավիթ', '', '   '])(
    'always produces something URL-safe for %s',
    (hosts) => {
      expect(invitationSlug(hosts, 'a1b2c3')).toMatch(/^[a-z0-9-]+$/);
    },
  );
});
