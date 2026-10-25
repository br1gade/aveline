import { describe, expect, it } from 'vitest';

import { ApiError } from './errors';
import { problemFrom } from './problems';

describe('problemFrom', () => {
  it.each([
    [new ApiError({ status: 0, messages: [] }), { code: 'unreachable' }],
    [new ApiError({ status: 429, messages: [] }), { code: 'rate-limited' }],
    [
      new ApiError({ status: 503, messages: [], requestId: 'r-1' }),
      { code: 'server', requestId: 'r-1' },
    ],
    [new ApiError({ status: 409, messages: [] }), { code: 'refused', status: 409 }],
    [new TypeError('boom'), { code: 'server', requestId: undefined }],
  ])('%s', (error, expected) => {
    expect(problemFrom(error)).toEqual(expected);
  });
});
