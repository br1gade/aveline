import { describe, expect, it } from 'vitest';

import {
  adviceOf,
  attemptOf,
  countActive,
  failureKey,
  isActive,
  nextStepOf,
  snapshotState,
  type SnapshotState,
} from './states';
import { snapshot } from './test-data';
import type { Snapshot } from './types';

const recovery = (action: string) => ({
  code: 'JOB_FAILED',
  locale: 'en',
  userMessage: 'x',
  action,
});

describe('where an export stands', () => {
  it.each<[string, Partial<Snapshot>, SnapshotState]>([
    ['queued, never tried', { status: 'QUEUED', attempts: 0, isDownloadable: false }, 'waiting'],
    ['being made', { status: 'RUNNING', attempts: 1, isDownloadable: false }, 'making'],
    [
      'sent back to the queue after an attempt',
      { status: 'QUEUED', attempts: 1, failureReason: 'GENERATION_FAILED', isDownloadable: false },
      'retrying',
    ],
    ['ready to download', { status: 'COMPLETED' }, 'ready'],
    ['completed, past its time', { status: 'COMPLETED', isDownloadable: false }, 'expired'],
    [
      'withdrawn after an erasure',
      {
        status: 'FAILED',
        failureReason: 'SUBJECT_ERASED',
        revokedAt: '2026-10-31T09:00:00.000Z',
        isDownloadable: false,
      },
      'withdrawn',
    ],
    [
      'withdrawn once completed',
      { status: 'COMPLETED', revokedAt: '2026-10-31T09:00:00.000Z', isDownloadable: false },
      'withdrawn',
    ],
    [
      'failed',
      { status: 'FAILED', attempts: 3, failureReason: 'GENERATION_FAILED', isDownloadable: false },
      'failed',
    ],
  ])('reads %s as %s', (_label, overrides, state) => {
    expect(snapshotState(snapshot(overrides))).toBe(state);
  });

  it('follows only what is queued or running and not withdrawn', () => {
    expect(isActive(snapshot({ status: 'QUEUED' }))).toBe(true);
    expect(isActive(snapshot({ status: 'RUNNING' }))).toBe(true);
    expect(isActive(snapshot({ status: 'COMPLETED' }))).toBe(false);
    expect(isActive(snapshot({ status: 'FAILED' }))).toBe(false);
    expect(isActive(snapshot({ status: 'RUNNING', revokedAt: '2026-10-31T09:00:00.000Z' }))).toBe(
      false,
    );
  });

  it('counts the exports an event has going, which the backend caps at ten', () => {
    const list = [
      snapshot({ id: 'a', status: 'QUEUED' }),
      snapshot({ id: 'b', status: 'RUNNING' }),
      snapshot({ id: 'c' }),
    ];
    expect(countActive(list)).toBe(2);
  });

  it('numbers the attempt under way, or the one coming, of three', () => {
    expect(attemptOf(snapshot({ status: 'RUNNING', attempts: 1 }))).toBe(1);
    expect(attemptOf(snapshot({ status: 'QUEUED', attempts: 1 }))).toBe(2);
    expect(attemptOf(snapshot({ status: 'QUEUED', attempts: 0 }))).toBe(1);
    expect(attemptOf(snapshot({ status: 'QUEUED', attempts: 3 }))).toBe(3);
  });
});

describe('our words for a failure', () => {
  it.each([
    ['GENERATION_FAILED', 'generation'],
    ['LEASE_EXHAUSTED', 'stopped'],
    ['SUBJECT_ERASED', 'erased'],
    ['INPUT_LIMIT_EXCEEDED', 'tooLarge'],
    ['OUTPUT_LIMIT_EXCEEDED', 'tooLargeForFormat'],
    ['ACCESS_REVOKED', 'accessLost'],
    ['STORAGE_UNAVAILABLE', 'storage'],
  ])('words %s as %s', (reason, key) => {
    expect(failureKey(reason)).toBe(key);
  });

  it('has none for a code it does not know, whose backend sentence is shown instead', () => {
    expect(failureKey('SOMETHING_NEW')).toBeNull();
    expect(failureKey(null)).toBeNull();
    expect(failureKey('toString')).toBeNull();
  });

  it('adds advice where the backend’s action asks for someone else', () => {
    expect(adviceOf(recovery('CONTACT_SUPPORT'))).toBe('support');
    expect(adviceOf(recovery('REQUEST_ACCESS'))).toBe('access');
    expect(adviceOf(recovery('RETRY'))).toBeNull();
    expect(adviceOf(recovery('REGENERATE'))).toBeNull();
    expect(adviceOf(null)).toBeNull();
  });
});

describe('what a row offers once it has ended (FR-59)', () => {
  const failed = (failureReason: string, overrides: Partial<Snapshot> = {}) =>
    snapshot({ status: 'FAILED', attempts: 1, failureReason, isDownloadable: false, ...overrides });

  it.each<[string, ReturnType<typeof nextStepOf>, Snapshot]>([
    ['a ready file', 'again', snapshot()],
    ['a failure it doesn’t know', 'again', failed('SOMETHING_NEW')],
    ['an unexpected failure', 'again', failed('GENERATION_FAILED', { attempts: 3 })],
    ['storage that stayed down', 'again', failed('STORAGE_UNAVAILABLE', { attempts: 3 })],
    ['an event too large for the report', 'none', failed('INPUT_LIMIT_EXCEEDED')],
    ['a PDF too large', 'otherFormat', failed('OUTPUT_LIMIT_EXCEEDED', { format: 'PDF' })],
    ['an XLSX too large', 'otherFormat', failed('OUTPUT_LIMIT_EXCEEDED', { format: 'XLSX' })],
    ['a CSV too large', 'none', failed('OUTPUT_LIMIT_EXCEEDED', { format: 'CSV' })],
    [
      'a guest list whose maker lost contact access, as the viewer may still have it',
      'again',
      failed('ACCESS_REVOKED', { includesContacts: true, revokedAt: '2026-10-31T09:00:00.000Z' }),
    ],
    [
      'a ticket manifest whose maker lost access',
      'again',
      failed('ACCESS_REVOKED', {
        kind: 'TICKET_MANIFEST',
        includesContacts: true,
        revokedAt: '2026-10-31T09:00:00.000Z',
      }),
    ],
  ])('for %s, offers %s', (_case, step, ended) => {
    expect(nextStepOf(ended)).toBe(step);
  });
});
