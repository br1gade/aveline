// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ApiError } from '@/api/errors';

import { revokeRefusalOf, staffRefusalOf } from './refusals';

function refused(status: number, message: string, code?: string) {
  return new ApiError({
    status,
    messages: [message],
    requestId: 'r-1',
    feedback: { code, action: undefined, userMessage: undefined, details: [] },
  });
}

const CODES = readFileSync(
  join(import.meta.dirname, '../../../../backend/src/common/domain-http.exception.ts'),
  'utf8',
);

describe('a refused change to Aveline staff (docs/API.md, "Aveline staff accounts")', () => {
  it.each([
    [404, 'STAFF_ACCOUNT_NOT_FOUND', 'notFound', undefined],
    [409, 'STAFF_EMAIL_UNVERIFIED', 'unverified', undefined],
    [409, 'STAFF_SELF_CHANGE', 'selfChange', true],
  ] as const)('knows %s %s, which the backend still sends', (status, code, kind, isStale) => {
    expect(CODES).toMatch(new RegExp(`${code}: \\{ status: ${status},`));
    expect(staffRefusalOf(refused(status, 'words', code))).toEqual({ kind, isStale });
  });

  it('reads the page again after a 403: this admin is one no longer', () => {
    expect(staffRefusalOf(refused(403, 'Forbidden'))).toEqual({ kind: 'forbidden', isStale: true });
  });

  it('puts an address the API refused under its field', () => {
    expect(staffRefusalOf(refused(400, 'email must be an email'))).toEqual({
      kind: 'emailRefused',
      isStale: undefined,
    });
  });

  it('says a refusal it can’t word as it came, with its reference', () => {
    expect(staffRefusalOf(refused(400, 'role must be one of ADMIN, SUPPORT'))).toEqual({
      kind: 'other',
      sentence: 'role must be one of ADMIN, SUPPORT',
      requestId: 'r-1',
      isStale: undefined,
    });
  });

  it.each([
    [429, { kind: 'rateLimited', isStale: undefined }],
    [503, { kind: 'noAnswer', requestId: 'r-1', isStale: undefined }],
    [0, { kind: 'noAnswer', requestId: 'r-1', isStale: undefined }],
  ])('%s', (status, expected) => {
    expect(staffRefusalOf(refused(status, 'busy'))).toEqual(expected);
  });

  it('reads the page again when the account to remove is gone', () => {
    expect(revokeRefusalOf(refused(404, 'gone', 'STAFF_ACCOUNT_NOT_FOUND'))).toEqual({
      kind: 'gone',
      isStale: true,
    });
    expect(revokeRefusalOf(refused(429, 'busy'))).toEqual({
      kind: 'rateLimited',
      isStale: undefined,
    });
  });

  it('throws what isn’t an API answer', () => {
    expect(() => staffRefusalOf(new TypeError('bug'))).toThrow('bug');
  });
});
