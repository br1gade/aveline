// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ApiError } from '@/api/errors';

import { refusalOf, SENTENCES } from './refusals';

const BACKEND = join(import.meta.dirname, '../../../../backend/src');
const SOURCES = [
  'infra/auth/account.service.ts',
  'modules/organizations/organization-membership.ts',
  'modules/organizations/organization-reviews.service.ts',
].map((path) => readFileSync(join(BACKEND, path), 'utf8'));

function refused(status: number, message: string, code?: string) {
  return new ApiError({
    status,
    messages: [message],
    requestId: 'r-1',
    feedback: { code, action: undefined, userMessage: undefined, details: [] },
  });
}

describe('what a refusal comes to', () => {
  it.each(SENTENCES.map(([words]) => words))('“%s” is still the backend’s words', (words) => {
    expect(SOURCES.some((source) => source.includes(`'${words}'`))).toBe(true);
  });

  it.each(['REVISION_CHANGED', 'OWNER_HANDOVER_REQUIRED'])('%s is still a code', (code) => {
    expect(SOURCES.some((source) => source.includes(`'${code}'`))).toBe(true);
  });

  it.each([
    [refused(409, 'x', 'REVISION_CHANGED'), 'changed', true],
    [refused(409, 'x', 'OWNER_HANDOVER_REQUIRED'), 'handover', true],
    [refused(400, 'That person is already a member'), 'alreadyMember', true],
    [refused(404, 'No pending invitation for that address'), 'noInvite', true],
    [refused(404, 'No such member'), 'memberGone', true],
    [refused(404, 'No active member in this organization'), 'memberGone', true],
    [refused(403, 'Only a current owner may request closure review'), 'onlyOwner', undefined],
    [refused(403, 'Forbidden resource'), 'forbidden', undefined],
    [refused(429, 'Too many'), 'rateLimited', undefined],
    [refused(400, 'email must be an email'), 'emailRefused', undefined],
    [refused(400, 'name must be longer'), 'nameRefused', undefined],
    [refused(403, 'x', 'ORGANIZATION_ACCESS_DENIED'), 'noOrganization', undefined],
    [refused(409, 'x', 'ORGANIZATION_SELECTION_REQUIRED'), 'chooseOrganization', undefined],
  ])('%#: reads it', (error, kind, isStale) => {
    const refusal = refusalOf(error);
    expect(refusal.kind).toBe(kind);
    expect(refusal.isStale).toBe(isStale);
  });

  it.each([500, 0])('keeps the reference for a status of %i', (status) => {
    expect(refusalOf(refused(status, 'Boom'))).toEqual({ kind: 'noAnswer', requestId: 'r-1' });
  });

  it('shows a sentence it doesn’t know as it came', () => {
    expect(refusalOf(refused(400, 'Something new'))).toMatchObject({
      kind: 'other',
      sentence: 'Something new',
    });
  });

  it('throws on what isn’t the API’s, which is a bug', () => {
    expect(() => refusalOf(new Error('bug'))).toThrow('bug');
  });
});
