import { describe, expect, it } from 'vitest';

import { ApiError } from '@/api/errors';

import { refusedTableFields } from './server-errors';

function badRequest(messages: string[], details: Array<{ field: string | null }> = []) {
  return new ApiError({
    status: 400,
    messages,
    feedback: {
      code: 'VALIDATION_FAILED',
      action: 'EDIT',
      userMessage: 'Check the highlighted fields.',
      details: details.map(({ field }) => ({ field, code: 'INVALID_FIELD', userMessage: '' })),
    },
  });
}

describe('a table form’s 400, placed under its fields', () => {
  it('reads the service’s prefixed sentences, with our own words for the two it explains', () => {
    expect(
      refusedTableFields(
        badRequest([
          'name: there is already a table called "Table 4" in this arrangement',
          'capacity: 7 guest(s) are seated here; move some first',
        ]),
      ),
    ).toEqual([
      { field: 'name', code: 'nameTaken' },
      { field: 'capacity', code: 'belowSeated' },
    ]);
    expect(
      refusedTableFields(badRequest(['capacity: move chairs outside the proposed capacity first'])),
    ).toEqual([{ field: 'capacity', code: 'chairsOutside' }]);
  });

  it('reads class-validator’s unprefixed sentences and the details’ fields (FR-20)', () => {
    expect(
      refusedTableFields(
        badRequest([
          'namePrefix must be shorter than or equal to 40 characters',
          'count must not be greater than 200',
        ]),
      ),
    ).toEqual([
      { field: 'namePrefix', code: 'refused' },
      { field: 'count', code: 'refused' },
    ]);
    expect(refusedTableFields(badRequest(['zone is wrong'], [{ field: 'zone' }]))).toEqual([
      { field: 'zone', code: 'refused' },
    ]);
  });

  it('names each field once, and nothing for a field the form lacks or another status', () => {
    expect(
      refusedTableFields(
        badRequest(['capacity must be an integer number'], [{ field: 'capacity' }]),
      ),
    ).toEqual([{ field: 'capacity', code: 'refused' }]);
    expect(
      refusedTableFields(badRequest(['venueId: v9 is not one of this event’s venues'])),
    ).toEqual([]);
    expect(refusedTableFields(new ApiError({ status: 409, messages: ['name: taken'] }))).toEqual(
      [],
    );
    expect(refusedTableFields(new Error('offline'))).toEqual([]);
  });
});
