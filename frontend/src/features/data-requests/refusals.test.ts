// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ApiError } from '@/api/errors';

import { requestRefusalOf } from './refusals';

function source(file: string): string {
  return readFileSync(
    join(import.meta.dirname, '../../../../backend/src/modules/privacy', file),
    'utf8',
  );
}

function refused(status: number, message: string) {
  return new ApiError({
    status,
    messages: [message],
    requestId: 'r-1',
    feedback: { code: undefined, action: undefined, userMessage: undefined, details: [] },
  });
}

describe('a refused step on a data request', () => {
  it.each([
    [
      'request-status.ts',
      'cannot become',
      'status: a request that is COMPLETED cannot become REJECTED',
    ],
    [
      'request-status.ts',
      'is completed by carrying',
      'status: an EXPORT is completed by carrying it out',
    ],
    [
      'privacy.service.ts',
      'must be IN_PROGRESS',
      'A request must be IN_PROGRESS to be carried out',
    ],
    [
      'privacy.service.ts',
      'is applied by editing',
      'A rectification is applied by editing the record',
    ],
  ])('knows the words in %s: %s', (file, words, said) => {
    expect(source(file)).toContain(words);
    expect(requestRefusalOf(refused(400, said))).toMatchObject({ kind: 'moved', isStale: true });
  });

  it.each([
    [404, 'No such request', 'moved'],
    [409, 'This request is being carried out by someone else', 'moved'],
    [403, 'Forbidden resource', 'forbidden'],
    [429, 'Too many', 'rateLimited'],
    [500, 'Internal', 'noAnswer'],
    [0, '', 'noAnswer'],
    [400, 'notes must be shorter', 'other'],
  ])('%i is %s', (status, message, kind) => {
    expect(requestRefusalOf(refused(status, message))).toMatchObject({ kind });
  });

  it('reads the page again only when it has moved on', () => {
    expect(requestRefusalOf(refused(403, 'x')).isStale).toBeUndefined();
    expect(requestRefusalOf(refused(500, 'x')).isStale).toBeUndefined();
  });

  it('gives back what it cannot read', () => {
    const bug = new TypeError('a bug');
    expect(() => requestRefusalOf(bug)).toThrow(bug);
  });
});
