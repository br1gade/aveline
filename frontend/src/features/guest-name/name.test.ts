import { describe, expect, it } from 'vitest';

import { ApiError } from '@/api/errors';

import { nameChange } from './payload';
import { nameSchema, type NameValues } from './schemas';
import { refusedNameFields } from './server-errors';

const saved = { firstName: 'Ani', lastName: 'Petrosyan' };

function issues(values: NameValues) {
  const result = nameSchema.safeParse(values);
  return result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join('.')}:${issue.message}`);
}

describe('the name form’s checks', () => {
  it('needs a first name, trimmed', () => {
    expect(issues({ firstName: '   ', lastName: '' })).toEqual(['firstName:required']);
    expect(nameSchema.parse({ firstName: '  Ani ', lastName: ' Dupont ' })).toEqual({
      firstName: 'Ani',
      lastName: 'Dupont',
    });
  });

  it('keeps each name to 100 characters, as the backend does', () => {
    expect(issues({ firstName: 'a'.repeat(100), lastName: 'b'.repeat(100) })).toEqual([]);
    expect(issues({ firstName: 'a'.repeat(101), lastName: 'b'.repeat(101) })).toEqual([
      'firstName:tooLong',
      'lastName:tooLong',
    ]);
  });

  it('refuses a null character, which the database cannot store', () => {
    const nul = String.fromCharCode(0);
    expect(issues({ firstName: `A${nul}ni`, lastName: `x${nul}` })).toEqual([
      'firstName:invalid',
      'lastName:invalid',
    ]);
  });
});

describe('what a correction sends', () => {
  it('sends only the name that changed', () => {
    expect(nameChange(saved, { firstName: 'Anna', lastName: 'Petrosyan' })).toEqual({
      firstName: 'Anna',
    });
    expect(nameChange(saved, { firstName: 'Ani', lastName: 'Dupont' })).toEqual({
      lastName: 'Dupont',
    });
  });

  it('clears an emptied surname with null', () => {
    expect(nameChange(saved, { firstName: 'Ani', lastName: '' })).toEqual({ lastName: null });
  });

  it('sends nothing when nothing changed, a missing surname left empty included', () => {
    expect(nameChange(saved, { firstName: 'Ani', lastName: 'Petrosyan' })).toBeNull();
    expect(
      nameChange({ firstName: 'Ani', lastName: null }, { firstName: 'Ani', lastName: '' }),
    ).toBeNull();
  });
});

describe('a refused correction, mapped to its fields', () => {
  it('reads the field from the backend’s details, then from the message', () => {
    const byDetails = new ApiError({
      status: 400,
      messages: ['lastName must be shorter than or equal to 100 characters'],
      feedback: {
        code: 'VALIDATION_FAILED',
        action: 'EDIT',
        userMessage: undefined,
        details: [{ field: 'lastName', code: 'TOO_LONG', userMessage: '…' }],
      },
    });
    expect(refusedNameFields(byDetails)).toEqual(['lastName']);
    const byMessage = new ApiError({
      status: 400,
      messages: ['firstName must not contain null characters'],
    });
    expect(refusedNameFields(byMessage)).toEqual(['firstName']);
  });

  it('names no field for a message about something else', () => {
    expect(refusedNameFields(new ApiError({ status: 400, messages: ['Bad request'] }))).toEqual([]);
  });
});
