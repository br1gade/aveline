// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ApiError } from '@/api/errors';

import { reviewRefusalOf } from './refusals';

function source(file: string): string {
  return readFileSync(join(import.meta.dirname, '../../../../backend/src', file), 'utf8');
}

function refused(status: number, message: string, code?: string) {
  return new ApiError({
    status,
    messages: [message],
    requestId: 'r-1',
    feedback: { code, action: undefined, userMessage: undefined, details: [] },
  });
}

const REVIEWS = 'modules/organizations/organization-reviews.service.ts';
const MEMBERSHIP = 'modules/organizations/organization-membership.ts';

describe('a refused decision on an access review', () => {
  it.each([
    [REVIEWS, 403, 'Platform administrator review is required', 'forbidden'],
    [REVIEWS, 403, 'Review is already resolved', 'moved'],
    [REVIEWS, 404, 'No such review', 'moved'],
    [REVIEWS, 403, 'An active successor is required', 'successor'],
    [MEMBERSHIP, 404, 'No active member in this organization', 'successor'],
  ])('knows the words in %s: %s', (file, status, words, kind) => {
    expect(source(file)).toContain(words);
    expect(reviewRefusalOf(refused(status, words))).toMatchObject({ kind });
  });

  it.each([
    [MEMBERSHIP, 409, 'REVISION_CHANGED'],
    ['infra/auth/organization-context.ts', 403, 'ORGANIZATION_ACCESS_DENIED'],
  ])('reads %s’s %s as out of date', (file, status, code) => {
    expect(source(file)).toContain(`'${code}'`);
    expect(reviewRefusalOf(refused(status, 'x', code))).toEqual({ kind: 'moved', isStale: true });
  });

  it.each([
    [403, 'Forbidden resource', 'forbidden'],
    [429, 'Too many', 'rateLimited'],
    [500, 'Internal', 'noAnswer'],
    [0, '', 'noAnswer'],
    [400, 'decision must be one of', 'other'],
  ])('%i is %s', (status, message, kind) => {
    expect(reviewRefusalOf(refused(status, message))).toMatchObject({ kind });
  });

  it('reads the page again only when it has moved on', () => {
    expect(reviewRefusalOf(refused(403, 'Forbidden resource')).isStale).toBeUndefined();
    expect(reviewRefusalOf(refused(404, 'No active member in this organization')).isStale).toBe(
      undefined,
    );
  });

  it('gives back what it cannot read', () => {
    const bug = new TypeError('a bug');
    expect(() => reviewRefusalOf(bug)).toThrow(bug);
  });
});
