// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ERASURE_COUNTS, readCarried, readRequest } from './read';
import type { DataRequest } from './types';

function source(path: string): string {
  return readFileSync(join(import.meta.dirname, '../../../../backend/src/modules', path), 'utf8');
}

/** The names a backend `return { … }` or `counts: { … }` gives its numbers. */
function namesIn(block: string): string[] {
  return [...block.matchAll(/\b([a-z][A-Za-z]+)\b\s*[:,]/g)].flatMap(([, name]) =>
    name ? [name] : [],
  );
}

describe('the counts an erasure answers with', () => {
  const counts = /counts: \{([^}]*)\}/.exec(source('privacy/erasure.ts'))?.[1] ?? '';
  const contributions = /return \{ (acknowledgementsErased[^}]*)\}/.exec(
    source('guest-contributions/contribution-privacy.ts'),
  )?.[1];
  const enquiries = /return \{ (enquiriesCleared[^}]*)\}/.exec(
    source('sales/enquiry-privacy.ts'),
  )?.[1];

  it('names every one the backend names', () => {
    const named = [
      ...namesIn(counts).filter((name) => /[A-Z]/.test(name)),
      ...namesIn(contributions ?? '').filter((name) => /[A-Z]/.test(name)),
      ...namesIn(enquiries ?? '').filter((name) => /[A-Z]/.test(name)),
    ];
    expect(named).toContain('accountsClosed');
    expect(named).toContain('privateMediaQueuedForDeletion');
    expect(named).toContain('enquiryNotesRedacted');
    expect(
      named.filter((name) => !name.endsWith('Counts') && !name.endsWith('Contributions')).sort(),
    ).toEqual([...ERASURE_COUNTS].sort());
  });
});

describe('the words for those counts', () => {
  it.each(['en', 'ru', 'fr', 'hy'])('are all there in %s', (language) => {
    const bundle = JSON.parse(
      readFileSync(
        join(import.meta.dirname, `../../locales/${language}/data-requests.json`),
        'utf8',
      ),
    ) as { erase: { count: Record<string, string> } };
    for (const name of ERASURE_COUNTS) expect(bundle.erase.count[name]).toBeTruthy();
  });
});

describe('what a request carried out answered', () => {
  it('takes a boolean for a step still outstanding, not as a count', () => {
    expect(
      readCarried('r1', {
        reference: 'r1',
        kind: 'ERASURE',
        guestsAnonymised: 2,
        recoveryPending: true,
      }),
    ).toEqual({
      kind: 'erasure',
      reference: 'r1',
      counts: [['guestsAnonymised', 2]],
      isRecoveryPending: true,
    });
  });

  it('counts nothing but numbers', () => {
    expect(readCarried('r1', { reference: 'r1', kind: 'ERASURE', note: 'x' })).toEqual({
      kind: 'erasure',
      reference: 'r1',
      counts: [],
      isRecoveryPending: false,
    });
  });

  it.each([
    ['/api/v1/privacy/requests/r1/guest-media/m1/file', [{ mediaId: 'm1' }]],
    ['https://elsewhere.example/api/v1/privacy/requests/r1/guest-media/m1/file', []],
    ['/api/v1/privacy/requests/r1/guest-media/m1/file?x=1', []],
    ['/api/v1/privacy/requests/r1/guest-media/a/b/file', []],
    [7, []],
  ])('offers the file at %s only if it has the one shape', (fileDownloadPath, files) => {
    const answer = { kind: 'EXPORT', contributions: { media: [{ fileDownloadPath }] } };
    expect(readCarried('r1', answer)).toMatchObject({ kind: 'export', files });
  });

  it.each([[null], ['text'], [{ contributions: 'x' }], [{ contributions: { media: 'x' } }]])(
    'finds no files in %j, and keeps it whole for the file',
    (answer) => {
      expect(readCarried('r1', answer)).toEqual({
        kind: 'export',
        reference: 'r1',
        result: answer,
        files: [],
      });
    },
  );
});

describe('a request as read', () => {
  it('keeps nothing it does not name', () => {
    const named: DataRequest = {
      id: 'r1',
      kind: 'EXPORT',
      status: 'RECEIVED',
      subjectEmail: 'ani@example.am',
      notes: null,
      erasureAppliedAt: null,
      requestedAt: '2026-11-01T00:00:00.000Z',
      dueAt: '2026-12-01T00:00:00.000Z',
    };
    expect(readRequest({ ...named, handledByUserId: 'u1' } as DataRequest)).toEqual(named);
  });
});
