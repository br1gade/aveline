import { describe, expect, it } from 'vitest';

import { walkInBody, walkInName, walkInSchema } from './walk-in';

describe('a walk-in at the door', () => {
  it('becomes a household of their own with one seat, the names trimmed', () => {
    expect(walkInBody({ firstName: ' Narek ', lastName: ' Sargsyan ' })).toEqual({
      firstName: 'Narek',
      lastName: 'Sargsyan',
      seatsAllotted: 1,
    });
  });

  it('sends no surname when none is given', () => {
    expect(walkInBody({ firstName: 'Narek', lastName: '  ' })).toEqual({
      firstName: 'Narek',
      seatsAllotted: 1,
    });
  });

  it('is named as the list will name them', () => {
    expect(walkInName({ firstName: ' Narek ', lastName: '' })).toBe('Narek');
    expect(walkInName({ firstName: 'Narek', lastName: 'Sargsyan' })).toBe('Narek Sargsyan');
  });

  it('needs a first name, and takes each name up to 80 characters', () => {
    const check = (firstName: string, lastName = '') =>
      walkInSchema.safeParse({ firstName, lastName }).error?.issues.map(({ message }) => message);
    expect(check('  ')).toEqual(['required']);
    expect(check('a'.repeat(80), 'b'.repeat(80))).toBeUndefined();
    expect(check('a'.repeat(81), 'b'.repeat(81))).toEqual(['tooLong', 'tooLong']);
  });
});
