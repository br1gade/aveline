import { BRIEF_SECTIONS, isBriefSection, sectionsFor } from './vendor-brief';

describe('sectionsFor', () => {
  it('grants exactly what the booking lists', () => {
    expect(sectionsFor(['catering', 'headcount'])).toEqual(['headcount', 'catering']);
  });

  it('returns a fixed order whatever order the scopes arrive in', () => {
    expect(sectionsFor(['timeline', 'bar', 'headcount'])).toEqual(
      sectionsFor(['headcount', 'timeline', 'bar']),
    );
  });

  it('de-duplicates', () => {
    expect(sectionsFor(['bar', 'bar', 'bar'])).toEqual(['bar']);
  });

  // A scope retired in a later release must not make an existing brief
  // unreadable, and dropping it can only narrow what the vendor sees.
  it.each([
    { label: 'an unknown scope', scopes: ['catering', 'nonsense'] },
    { label: 'a staff permission name', scopes: ['catering', 'guest:contact:read'] },
    { label: 'a path', scopes: ['catering', '../../etc/passwd'] },
  ])('ignores $label', ({ scopes }) => {
    expect(sectionsFor(scopes)).toEqual(['catering']);
  });

  it('grants nothing for an empty scope list', () => {
    expect(sectionsFor([])).toEqual([]);
  });

  /**
   * The security property: a brief can never contain a section the booking
   * did not list, whatever is in the scope array.
   */
  it('never grants a section outside the vocabulary', () => {
    const everything = sectionsFor(['nonsense', ...BRIEF_SECTIONS, 'more-nonsense']);
    expect(everything).toEqual([...BRIEF_SECTIONS]);
    expect(everything.every(isBriefSection)).toBe(true);
  });
});
