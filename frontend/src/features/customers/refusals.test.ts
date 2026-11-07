// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ApiError } from '@/api/errors';

import { customerRefusalOf } from './refusals';

const CONTEXT = readFileSync(
  join(import.meta.dirname, '../../../../backend/src/infra/auth/organization-context.ts'),
  'utf8',
);

function refused(status: number, message: string, code?: string) {
  return new ApiError({
    status,
    messages: [message],
    requestId: 'r-1',
    feedback: { code, action: undefined, userMessage: undefined, details: [] },
  });
}

describe('a refusal of the customer screens', () => {
  it.each([
    [refused(409, 'x', 'ORGANIZATION_SELECTION_REQUIRED'), 'needsChoice'],
    [refused(403, 'Forbidden resource'), 'forbidden'],
    [refused(429, 'Too many'), 'rateLimited'],
    [refused(400, 'ownerEmail must be an email'), 'emailRefused'],
    [refused(400, 'name must be longer than or equal to 2 characters'), 'nameRefused'],
    [refused(403, 'x', 'ORGANIZATION_ACCESS_DENIED'), 'gone'],
    [refused(500, 'Boom'), 'noAnswer'],
    [refused(0, 'Boom'), 'noAnswer'],
  ])('$messages.0 is %s', (error, kind) => {
    expect(customerRefusalOf(error).kind).toBe(kind);
  });

  it('keeps the reference for no answer', () => {
    expect(customerRefusalOf(refused(500, 'Boom'))).toEqual({
      kind: 'noAnswer',
      requestId: 'r-1',
    });
  });

  it('shows what it doesn’t know as it came', () => {
    expect(customerRefusalOf(refused(400, 'Something new'))).toMatchObject({
      kind: 'other',
      sentence: 'Something new',
    });
  });

  it('throws on what isn’t the API’s', () => {
    expect(() => customerRefusalOf(new Error('bug'))).toThrow('bug');
  });

  it('reads the backend’s own codes', () => {
    expect(CONTEXT).toContain("'ORGANIZATION_SELECTION_REQUIRED'");
    expect(CONTEXT).toContain("'ORGANIZATION_ACCESS_DENIED'");
  });
});
