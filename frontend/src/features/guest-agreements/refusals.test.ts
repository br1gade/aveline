import { describe, expect, it } from 'vitest';

import { ApiError, networkError } from '@/api/errors';

import { agreementRefusal } from './refusals';

describe('an agreement the backend refused', () => {
  it.each([
    [
      new ApiError({ status: 409, messages: ['statementVersionId: this statement changed'] }),
      { kind: 'reworded' },
    ],
    [new ApiError({ status: 404, messages: ['Not found'] }), { kind: 'gone' }],
    [new ApiError({ status: 429, messages: [] }), { kind: 'rateLimited' }],
    [
      new ApiError({ status: 400, messages: ['assetId: use a READY signature upload'] }),
      { kind: 'refused', sentence: 'assetId: use a READY signature upload' },
    ],
    [
      new ApiError({ status: 503, messages: [], requestId: 'r1' }),
      { kind: 'failed', requestId: 'r1' },
    ],
    [networkError('r0'), { kind: 'failed', requestId: 'r0' }],
  ])('%#: reads as %o', (error, refusal) => {
    expect(agreementRefusal(error)).toEqual(refusal);
  });
});
