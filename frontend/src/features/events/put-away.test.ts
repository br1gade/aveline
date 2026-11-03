import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ApiError, networkError } from '@/api/errors';

import {
  ARCHIVED_SENTENCE,
  isArchived,
  isDeletable,
  putAwayRefusalOf,
  SENTENCES,
} from './put-away';

describe('isDeletable', () => {
  it.each([
    [{ status: 'DRAFT' as const, statusBeforeArchive: null }, true],
    [{ status: 'PUBLISHED' as const, statusBeforeArchive: null }, false],
    [{ status: 'COMPLETED' as const, statusBeforeArchive: null }, false],
    [{ status: 'ARCHIVED' as const, statusBeforeArchive: 'DRAFT' as const }, true],
    [{ status: 'ARCHIVED' as const, statusBeforeArchive: 'PUBLISHED' as const }, false],
    [{ status: 'ARCHIVED' as const, statusBeforeArchive: null }, true],
    [{}, true],
  ])('offers deleting %o: %s', (event, expected) => {
    expect(isDeletable(event)).toBe(expected);
  });

  it('knows an archived event', () => {
    expect(isArchived({ status: 'ARCHIVED' })).toBe(true);
    expect(isArchived({ status: 'DRAFT' })).toBe(false);
    expect(isArchived({})).toBe(false);
  });
});

describe('putAwayRefusalOf', () => {
  const refused = (status: number, message = 'refused') =>
    new ApiError({ status, messages: [message], requestId: `r-${status}` });

  it.each([
    [refused(403), { kind: 'forbidden' }],
    [refused(429), { kind: 'rateLimited' }],
    [refused(500), { kind: 'noAnswer', requestId: 'r-500' }],
    [refused(499, 'New'), { kind: 'other', sentence: 'New' }],
    [networkError(), { kind: 'noAnswer' }],
    [refused(404), { kind: 'gone', isStale: true }],
    [refused(400, 'New words'), { kind: 'other', sentence: 'New words', requestId: 'r-400' }],
  ])('words %#', (error, expected) => {
    expect(putAwayRefusalOf(error)).toMatchObject(expected);
  });

  it.each(SENTENCES.map(([words, kind]) => [words, kind]))('recognises “%s”', (words, kind) => {
    expect(putAwayRefusalOf(refused(409, words))).toEqual({ kind, isStale: true });
  });

  it('throws on what isn’t the API’s', () => {
    expect(() => putAwayRefusalOf(new Error('bug'))).toThrow('bug');
  });
});

describe('the backend’s sentences', () => {
  it('are still in its sources', () => {
    const source = join(process.cwd(), '..', 'backend', 'src', 'modules');
    const sources = [
      'events/events.service.ts',
      'events/event-lock.ts',
      'invitations/publishing.service.ts',
    ]
      .map((path) => readFileSync(join(source, path), 'utf8'))
      .join('');
    for (const [words] of SENTENCES) expect(sources).toContain(words);
    expect(sources).toContain(ARCHIVED_SENTENCE);
  });
});
