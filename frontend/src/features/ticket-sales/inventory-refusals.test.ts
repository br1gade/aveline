import { describe, expect, it } from 'vitest';

import { ApiError } from '@/api/errors';

import { inventoryRefusalOf } from './inventory-refusals';

function refused(status: number, message = 'refused') {
  return new ApiError({
    status,
    messages: [message],
    requestId: 'r-1',
    feedback: { code: undefined, action: undefined, userMessage: undefined, details: [] },
  });
}

describe('a refused inventory or layout, in words (FR-6)', () => {
  it.each([
    [403, 'forbidden'],
    [404, 'gone'],
    [409, 'changed'],
    [429, 'rateLimited'],
    [500, 'noAnswer'],
    [0, 'noAnswer'],
  ])('reads %i as %s', (status, kind) => {
    expect(inventoryRefusalOf(refused(status))).toMatchObject({ kind });
  });

  it('keeps the backend’s sentence for a 400, to show as it came', () => {
    expect(inventoryRefusalOf(refused(400, 'sections.0.rows: duplicate seat A1'))).toEqual({
      kind: 'invalid',
      sentence: 'sections.0.rows: duplicate seat A1',
    });
  });

  it('says an answer it couldn’t read is that, not the host’s mistake', () => {
    expect(inventoryRefusalOf(new TypeError('parse'))).toEqual({ kind: 'unreadable' });
  });
});
