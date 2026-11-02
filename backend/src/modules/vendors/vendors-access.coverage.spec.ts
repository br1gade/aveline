import { VendorCategory } from '@prisma/client';
import { SUGGESTED_SCOPES, isBriefSection } from './vendor-brief';

/**
 * The category defaults are what a host gets when they do not think about
 * scopes, so they decide what most vendors read. docs/ACCESS_CONTROL.md §1:
 * `contacts`, the only scope carrying phone numbers, is never granted by
 * default.
 */
describe('the scopes a vendor gets by default', () => {
  const categories = Object.values(VendorCategory);

  it.each(categories)('gives a %s vendor a default that withholds guest contacts', (category) => {
    expect(SUGGESTED_SCOPES[category]).toBeDefined();
    expect(SUGGESTED_SCOPES[category]).not.toContain('contacts');
  });

  it.each(categories)('builds the %s default only from brief sections', (category) => {
    expect(SUGGESTED_SCOPES[category].every(isBriefSection)).toBe(true);
  });

  it('has no default for a category the database does not know', () => {
    expect(Object.keys(SUGGESTED_SCOPES).sort()).toEqual([...categories].sort());
  });
});
