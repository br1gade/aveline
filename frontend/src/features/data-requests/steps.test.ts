// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isStuckWithoutAddress, nextSteps } from './steps';
import type { RequestKind, RequestStatus } from './types';

const SOURCE = readFileSync(
  join(import.meta.dirname, '../../../../backend/src/modules/privacy/request-status.ts'),
  'utf8',
);
const EMAIL = 'ani@example.am';

describe('what may be done next to a request', () => {
  const asked = (
    kind: RequestKind,
    status: RequestStatus,
    subjectEmail: string | null = EMAIL,
    erasureAppliedAt: string | null = null,
  ) => ({ kind, status, subjectEmail, erasureAppliedAt });

  it.each([
    ['EXPORT', 'RECEIVED', ['verify', 'confirm', 'reject']],
    ['EXPORT', 'VERIFYING', ['confirm', 'reject']],
    ['EXPORT', 'IN_PROGRESS', ['export', 'reject']],
    ['ERASURE', 'IN_PROGRESS', ['erase', 'reject']],
    ['RECTIFICATION', 'IN_PROGRESS', ['close', 'reject']],
    ['ERASURE', 'COMPLETED', []],
    ['EXPORT', 'REJECTED', []],
  ] as const)('%s, %s', (kind, status, steps) => {
    expect(nextSteps(asked(kind, status))).toEqual(steps);
  });

  it('carries nothing out until someone has said who the requester is', () => {
    for (const status of ['RECEIVED', 'VERIFYING'] as const) {
      expect(nextSteps(asked('ERASURE', status))).not.toContain('erase');
      expect(nextSteps(asked('EXPORT', status))).not.toContain('export');
    }
  });

  it.each(['RECEIVED', 'VERIFYING', 'IN_PROGRESS'] as const)(
    'with no address, only rejects an export or erasure that is %s, and says why',
    (status) => {
      for (const kind of ['EXPORT', 'ERASURE'] as const) {
        expect(nextSteps(asked(kind, status, null))).toEqual(['reject']);
        expect(isStuckWithoutAddress(asked(kind, status, null))).toBe(true);
      }
    },
  );

  it('moves a correction along with no address, as closing it carries nothing out', () => {
    const correction = asked('RECTIFICATION', 'IN_PROGRESS', null);
    expect(nextSteps(correction)).toEqual(['close', 'reject']);
    expect(isStuckWithoutAddress(correction)).toBe(false);
    expect(nextSteps(asked('RECTIFICATION', 'RECEIVED', null))).toEqual([
      'verify',
      'confirm',
      'reject',
    ]);
  });

  it('isn’t stuck with an address, or once closed', () => {
    expect(isStuckWithoutAddress(asked('ERASURE', 'IN_PROGRESS'))).toBe(false);
    expect(isStuckWithoutAddress(asked('ERASURE', 'COMPLETED', null))).toBe(false);
  });

  it('only finishes an erasure already applied: rejecting would record the opposite', () => {
    const applied = asked('ERASURE', 'IN_PROGRESS', EMAIL, '2026-11-04T10:00:00Z');
    expect(nextSteps(applied)).toEqual(['erase']);
  });

  it('offers nothing with no address, even once applied: there is none to confirm by', () => {
    const applied = asked('ERASURE', 'IN_PROGRESS', null, '2026-11-04T10:00:00Z');
    expect(nextSteps(applied)).toEqual([]);
    expect(isStuckWithoutAddress(applied)).toBe(true);
  });

  it('holds to the moves the backend allows', () => {
    expect(SOURCE).toContain('[RECEIVED]: [VERIFYING, IN_PROGRESS, REJECTED]');
    expect(SOURCE).toContain('[VERIFYING]: [IN_PROGRESS, REJECTED]');
    expect(SOURCE).toContain('[IN_PROGRESS]: [REJECTED, COMPLETED]');
    expect(SOURCE).toContain('to === COMPLETED && kind !== DataSubjectRequestKind.REC');
  });
});
