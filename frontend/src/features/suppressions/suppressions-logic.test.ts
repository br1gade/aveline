import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ApiError, networkError } from '@/api/errors';

import { readSuppressions } from './read';
import {
  findListed,
  isLiftable,
  LIST_LIMIT,
  mayBeTruncated,
  SENTENCES,
  suppressionRefusalOf,
} from './rules';
import { suppressionSchema } from './schemas';
import type { SuppressionWire } from './types';
import { ADDRESSES_NOBODY_TAKES, ADDRESSES_THE_BACKEND_TAKES } from '../../../test/emails';

function wire(overrides: Partial<SuppressionWire> = {}): SuppressionWire {
  return {
    id: 's1',
    channel: 'EMAIL',
    address: 'ani@example.am',
    reason: 'UNSUBSCRIBED',
    scope: 'ORGANIZATION',
    notes: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('reading the list', () => {
  it('keeps the order, marks global and erased entries, and reads a new reason as other', () => {
    const list = readSuppressions([
      wire(),
      wire({ id: 's2', scope: 'GLOBAL', reason: 'HARD_BOUNCE' }),
      wire({ id: 's3', reason: 'ERASED', address: '[erased]' }),
      wire({ id: 's4', reason: 'SOMETHING_NEW', channel: 'CARRIER_PIGEON' }),
    ]);
    expect(list.map((entry) => entry.id)).toEqual(['s1', 's2', 's3', 's4']);
    expect(list[1]).toMatchObject({ isGlobal: true, reason: 'HARD_BOUNCE' });
    expect(list[2]).toMatchObject({ isErasedAddress: true, reason: 'ERASED' });
    expect(list[3]).toMatchObject({ reason: 'OTHER', channel: 'OTHER' });
  });
});

describe('what may be lifted', () => {
  it.each([
    [wire(), true],
    [wire({ reason: 'MANUAL' }), true],
    [wire({ scope: 'GLOBAL', reason: 'COMPLAINT' }), false],
    [wire({ reason: 'ERASED' }), false],
  ])('%o: %s', (entry, expected) => {
    const [read] = readSuppressions([entry]);
    expect(read && isLiftable(read)).toBe(expected);
  });

  it('says the list may have stopped at the backend’s limit, and not below it', () => {
    const many = (count: number) => readSuppressions(Array.from({ length: count }, () => wire()));
    expect(mayBeTruncated(many(LIST_LIMIT))).toBe(true);
    expect(mayBeTruncated(many(LIST_LIMIT - 1))).toBe(false);
  });
});

describe('an address already listed (design PD-115)', () => {
  const list = readSuppressions([
    wire(),
    wire({ id: 's2', channel: 'SMS', address: '+374 91 000000' }),
  ]);

  it('is found by email without regard to capitals or spaces', () => {
    expect(findListed(list, 'EMAIL', '  Ani@Example.AM ')?.id).toBe('s1');
  });

  it('is found by phone only as typed, and only on its channel', () => {
    expect(findListed(list, 'SMS', '+374 91 000000')?.id).toBe('s2');
    expect(findListed(list, 'SMS', '+37491000000')).toBeUndefined();
    expect(findListed(list, 'WHATSAPP', '+374 91 000000')).toBeUndefined();
  });
});

describe('the form', () => {
  const problems = (values: object) => {
    const result = suppressionSchema.safeParse(values);
    return result.success ? [] : result.error.issues.map((issue) => issue.message);
  };

  it.each([
    [{ channel: 'EMAIL', address: '' }, ['required']],
    [{ channel: 'EMAIL', address: 'not an email' }, ['email']],
    [{ channel: 'EMAIL', address: 'ani@example.am' }, []],
    [{ channel: 'SMS', address: 'call me' }, ['phone']],
    [{ channel: 'WHATSAPP', address: '+374 (91) 00-00-00' }, []],
    [{ channel: 'EMAIL', address: `${'a'.repeat(196)}@x.am` }, ['tooLong']],
    [{ channel: 'EMAIL', address: `${'a'.repeat(195)}@x.am` }, []],
    [{ channel: 'SMS', address: '12345' }, ['phone']],
    [{ channel: 'SMS', address: '123456' }, []],
  ])('checks %o', (values, expected) => {
    expect(problems(values)).toEqual(expected);
  });
});

describe('suppressionRefusalOf', () => {
  const refused = (status: number, message = 'refused', code?: string) =>
    new ApiError({
      status,
      messages: [message],
      requestId: `r-${status}`,
      ...(code
        ? { feedback: { code, action: undefined, userMessage: undefined, details: [] } }
        : {}),
    });

  it.each([
    [
      refused(403, 'organizationId: access is unavailable', 'ORGANIZATION_ACCESS_DENIED'),
      { kind: 'noOrganization' },
    ],
    [refused(403, 'This account may not guest:write', 'FORBIDDEN'), { kind: 'forbidden' }],
    [refused(429), { kind: 'rateLimited' }],
    [
      refused(
        409,
        'organizationId: select an organization for this action',
        'ORGANIZATION_SELECTION_REQUIRED',
      ),
      { kind: 'chooseOrganization' },
    ],
    [refused(499), { kind: 'other' }],
    [refused(500), { kind: 'noAnswer', requestId: 'r-500' }],
    [networkError(), { kind: 'noAnswer' }],
    [refused(404, 'No such suppression'), { kind: 'gone', isStale: true }],
    [
      refused(400, 'address must be shorter than or equal to 200 characters'),
      { kind: 'addressRefused' },
    ],
    [refused(400, 'New words'), { kind: 'other', sentence: 'New words' }],
  ])('words %#', (error, expected) => {
    expect(suppressionRefusalOf(error)).toMatchObject(expected);
  });

  it.each(SENTENCES.map(([words, kind]) => [words, kind]))('recognises “%s”', (words, kind) => {
    expect(suppressionRefusalOf(refused(409, words))).toEqual({ kind, isStale: true });
  });

  it('throws on what isn’t the API’s', () => {
    expect(() => suppressionRefusalOf(new Error('bug'))).toThrow('bug');
  });
});

describe('the backend', () => {
  const read = (path: string) =>
    readFileSync(join(process.cwd(), '..', 'backend', 'src', path), 'utf8');

  it('still words its refusals so', () => {
    const source = read('modules/communications/suppression.service.ts');
    for (const [words] of SENTENCES) expect(source).toContain(words);
  });

  it('still lists at most the limit the page warns of', () => {
    expect(read('modules/communications/suppression.service.ts')).toContain(`take: ${LIST_LIMIT}`);
  });
});

describe('an address not to contact', () => {
  it.each(ADDRESSES_THE_BACKEND_TAKES)('takes %s by email', (address) => {
    expect(suppressionSchema.safeParse({ channel: 'EMAIL', address }).success).toBe(true);
  });

  it.each(ADDRESSES_NOBODY_TAKES)('refuses %s by email, saying so', (address) => {
    const parsed = suppressionSchema.safeParse({ channel: 'EMAIL', address });
    expect(parsed.error?.issues[0]?.message).toBe('email');
  });

  it('still reads a phone’s rule for a phone, not an address’s', () => {
    expect(suppressionSchema.safeParse({ channel: 'SMS', address: 'ani@example.am' }).success).toBe(
      false,
    );
    expect(suppressionSchema.safeParse({ channel: 'SMS', address: '+37491123456' }).success).toBe(
      true,
    );
  });
});
