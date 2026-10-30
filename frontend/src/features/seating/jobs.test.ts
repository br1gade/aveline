import { describe, expect, it, vi } from 'vitest';

import {
  failureKey,
  followJob,
  isActive,
  isResultStale,
  jobPhase,
  latestJobOf,
  POLL_DELAYS,
  unseatedKey,
} from './jobs';
import type { Arrangement, SeatingJob } from './types';

function job(overrides: Partial<SeatingJob> = {}): SeatingJob {
  return {
    id: 'j1',
    arrangementId: 'a1',
    status: 'QUEUED',
    attempts: 0,
    failureReason: null,
    recoveryMessage: null,
    appliedRevision: null,
    createdAt: '2027-06-01T10:00:00.000Z',
    completedAt: null,
    result: null,
    ...overrides,
  };
}

const PLAN: Arrangement = {
  id: 'a1',
  venueId: 'hall',
  venueName: 'Hall',
  venueCapacity: null,
  revision: 40,
  tableCount: 3,
};

describe('a plan’s runs', () => {
  it('takes the newest run of this plan from the history, which comes newest first', () => {
    const history = [job({ id: 'j3', arrangementId: 'a2' }), job({ id: 'j2' }), job({ id: 'j1' })];
    expect(latestJobOf(history, 'a1')?.id).toBe('j2');
    expect(latestJobOf(history, 'a9')).toBeUndefined();
  });

  it.each([
    ['QUEUED', true],
    ['RUNNING', true],
    ['COMPLETED', false],
    ['FAILED', false],
  ] as const)('a %s run is still going: %s', (status, expected) => {
    expect(isActive(job({ status }))).toBe(expected);
  });

  it.each([
    [job(), 'waiting'],
    [job({ status: 'RUNNING', attempts: 1 }), 'planning'],
    [job({ status: 'QUEUED', attempts: 1, failureReason: 'STATE_CHANGED' }), 'retrying'],
    [job({ status: 'RUNNING', attempts: 2 }), 'planning'],
    [job({ status: 'COMPLETED', attempts: 1 }), 'done'],
    [job({ status: 'FAILED', attempts: 3, failureReason: 'STATE_CHANGED' }), 'failed'],
  ] as const)('reads its phase', (value, phase) => {
    expect(jobPhase(value)).toBe(phase);
  });

  it('calls a result stale once the plan has changed since it was applied', () => {
    expect(isResultStale(job({ status: 'COMPLETED', appliedRevision: 40 }), PLAN)).toBe(false);
    expect(isResultStale(job({ status: 'COMPLETED', appliedRevision: 38 }), PLAN)).toBe(true);
    expect(isResultStale(job({ status: 'FAILED', appliedRevision: null }), PLAN)).toBe(false);
  });
});

describe('the words for a run', () => {
  it.each([
    ['STATE_CHANGED', 'stateChanged'],
    ['ACCESS_REVOKED', 'accessRevoked'],
    ['EVENT_UNAVAILABLE', 'eventUnavailable'],
    ['INPUT_LIMIT_EXCEEDED', 'tooLarge'],
    ['PLANNING_LIMIT_EXCEEDED', 'tooLarge'],
    ['LEASE_EXHAUSTED', 'failed'],
    ['LEASE_LOST', 'failed'],
    ['PLANNING_FAILED', 'failed'],
  ])('a failure %s is %s', (reason, key) => {
    expect(failureKey(reason)).toBe(key);
  });

  it('leaves an unknown failure to the backend’s own sentence', () => {
    expect(failureKey('SOMETHING_NEW')).toBeNull();
    expect(failureKey(null)).toBeNull();
  });

  it.each([
    ['SEATING_VENUE_CAPACITY', 'venueFull'],
    ['SEATING_FAMILY_TABLE_FULL', 'householdTableFull'],
    ['SEATING_NO_TABLES', 'noTables'],
    ['SEATING_TABLES_FULL', 'tablesFull'],
    ['SEATING_NO_TABLE_FITS', 'noTableFits'],
    ['SEATING_UNAVAILABLE', 'review'],
  ])('an unseated household’s %s is %s', (code, key) => {
    expect(unseatedKey(code)).toBe(key);
  });

  it('leaves an unknown reason to the backend’s sentence', () => {
    expect(unseatedKey('SEATING_SOMETHING')).toBeNull();
    expect(unseatedKey(null)).toBeNull();
  });
});

describe('following a run until it ends', () => {
  const noWait = () => Promise.resolve();

  it('waits about three minutes in all, the first reads soon', () => {
    expect(POLL_DELAYS.slice(0, 3)).toEqual([1000, 2000, 3000]);
    const total = POLL_DELAYS.reduce((sum, delay) => sum + delay, 0);
    expect(total).toBeGreaterThanOrEqual(170_000);
    expect(total).toBeLessThanOrEqual(190_000);
  });

  it('reports each phase it reads, and ends with the finished run', async () => {
    const read = vi
      .fn<() => Promise<SeatingJob>>()
      .mockResolvedValueOnce(job({ status: 'RUNNING', attempts: 1 }))
      .mockResolvedValueOnce(job({ status: 'QUEUED', attempts: 1, failureReason: 'STATE_CHANGED' }))
      .mockResolvedValueOnce(job({ status: 'COMPLETED', attempts: 2 }));
    const seen = vi.fn();
    const signal = new AbortController().signal;
    const finished = await followJob({
      read,
      onRead: seen,
      wait: noWait,
      signal,
      delays: [1, 1, 1, 1],
    });
    expect(finished?.status).toBe('COMPLETED');
    expect(seen.mock.calls.map((call) => jobPhase(call[0] as SeatingJob))).toEqual([
      'planning',
      'retrying',
      'done',
    ]);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('ends on a failure too', async () => {
    const read = vi.fn(() => Promise.resolve(job({ status: 'FAILED', attempts: 3 })));
    const signal = new AbortController().signal;
    const finished = await followJob({
      read,
      onRead: vi.fn(),
      wait: noWait,
      signal,
      delays: [1, 1],
    });
    expect(finished?.status).toBe('FAILED');
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('gives up quietly when the waits run out, or the page stops waiting', async () => {
    const read = vi.fn(() => Promise.resolve(job({ status: 'RUNNING', attempts: 1 })));
    const signal = new AbortController().signal;
    await expect(
      followJob({ read, onRead: vi.fn(), wait: noWait, signal, delays: [1, 1, 1] }),
    ).resolves.toBeUndefined();
    expect(read).toHaveBeenCalledTimes(3);
    const stopped = new AbortController();
    stopped.abort();
    const later = vi.fn(() => Promise.resolve(job()));
    await expect(
      followJob({
        read: later,
        onRead: vi.fn(),
        wait: noWait,
        signal: stopped.signal,
        delays: [1],
      }),
    ).resolves.toBeUndefined();
    expect(later).not.toHaveBeenCalled();
  });
});
