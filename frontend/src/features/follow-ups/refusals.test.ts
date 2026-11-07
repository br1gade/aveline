import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ApiError, networkError } from '@/api/errors';

import { NOT_REACHED_REASON } from './read';
import { refusalOf, SENTENCES } from './refusals';

const refused = (status: number, message: string) =>
  new ApiError({ status, messages: [message], requestId: `r-${status}` });

describe('a reminder or a thank-you refused', () => {
  it.each([
    [refused(400, 'This invitation has not been published, so nobody has it yet'), 'notPublished'],
    [refused(400, 'This invitation has expired'), 'expired'],
    [refused(400, 'This event has already started; a reminder would read oddly'), 'started'],
    [
      refused(
        400,
        'This event has not happened yet; a thank-you now would arrive before the event',
      ),
      'notYet',
    ],
    [refused(403, 'Forbidden'), 'forbidden'],
    [refused(404, 'No invitation at "anna"'), 'gone'],
    [refused(429, 'Too many'), 'rateLimited'],
  ])('reads %s', (error, kind) => {
    expect(refusalOf(error).kind).toBe(kind);
  });

  it('treats no answer and a server failure alike: pressing again is safe', () => {
    expect(refusalOf(networkError())).toMatchObject({ kind: 'noAnswer' });
    expect(refusalOf(refused(502, 'Bad gateway'))).toEqual({
      kind: 'noAnswer',
      requestId: 'r-502',
    });
  });

  it('shows a sentence it does not know as it came, never as a wrong reason', () => {
    expect(refusalOf(refused(400, 'Something new happened'))).toEqual({
      kind: 'other',
      sentence: 'Something new happened',
      requestId: 'r-400',
    });
  });

  it('reloads the page behind a refusal about its state, not behind a role or no answer', () => {
    expect(refusalOf(refused(400, 'This invitation has expired')).isStale).toBe(true);
    expect(refusalOf(refused(404, 'No invitation at "anna"')).isStale).toBe(true);
    expect(refusalOf(refused(403, 'Forbidden')).isStale).toBeUndefined();
    expect(refusalOf(networkError()).isStale).toBeUndefined();
  });
});

describe('a failure that isn’t the API’s', () => {
  it('is thrown on: a bug must not read as “no answer”', () => {
    expect(() => refusalOf(new TypeError('a bug'))).toThrow('a bug');
  });
});

describe('the backend’s sentences', () => {
  const source = join(process.cwd(), '..', 'backend', 'src', 'modules', 'invitations', 'sending');

  it('are still in its source', () => {
    const service = readFileSync(join(source, 'reminder.service.ts'), 'utf8');
    expect(service).toContain(NOT_REACHED_REASON);
    for (const [words] of SENTENCES) {
      expect(service).toContain(words);
    }
  });
});
