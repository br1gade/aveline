import { pollUntil } from '@/lib/poll';

import type { Arrangement, SeatingJob } from './types';

/** The history comes newest first (`seating-jobs.service.ts`, `list`), at most fifty for the event. */
export function latestJobOf(
  history: readonly SeatingJob[],
  arrangementId: string,
): SeatingJob | undefined {
  return history.find((job) => job.arrangementId === arrangementId);
}

export function isActive(job: SeatingJob): boolean {
  return job.status === 'QUEUED' || job.status === 'RUNNING';
}

/**
 * What the page says of a run (design PD-70). A run sent back to the queue after an attempt is
 * retrying: the worker found the plan or the answers changed (`STATE_CHANGED`) or lost its claim,
 * and tries again with the latest list, up to three attempts in all.
 */
export type JobPhase = 'waiting' | 'planning' | 'retrying' | 'done' | 'failed';

export function jobPhase(job: SeatingJob): JobPhase {
  if (job.status === 'COMPLETED') return 'done';
  if (job.status === 'FAILED') return 'failed';
  if (job.status === 'RUNNING') return 'planning';
  return job.attempts > 0 ? 'retrying' : 'waiting';
}

/** A result describes its own attempt; once the plan moved on, the tables shown are the truth. */
export function isResultStale(job: SeatingJob, plan: Arrangement): boolean {
  return (
    job.status === 'COMPLETED' &&
    job.appliedRevision !== null &&
    plan.revision > job.appliedRevision
  );
}

export type FailureKey =
  'stateChanged' | 'accessRevoked' | 'eventUnavailable' | 'tooLarge' | 'failed';

const FAILURES: Readonly<Record<string, FailureKey>> = {
  STATE_CHANGED: 'stateChanged',
  ACCESS_REVOKED: 'accessRevoked',
  EVENT_UNAVAILABLE: 'eventUnavailable',
  INPUT_LIMIT_EXCEEDED: 'tooLarge',
  PLANNING_LIMIT_EXCEEDED: 'tooLarge',
  LEASE_EXHAUSTED: 'failed',
  LEASE_LOST: 'failed',
  PLANNING_FAILED: 'failed',
};

/**
 * Our words for a failure's stable code (docs/API.md §6, the worker runbook's list). An unknown one
 * is shown in the backend's own sentence, which comes in the page's language.
 */
export function failureKey(reason: string | null): FailureKey | null {
  return reason !== null && Object.hasOwn(FAILURES, reason) ? (FAILURES[reason] ?? null) : null;
}

export type UnseatedKey =
  'venueFull' | 'householdTableFull' | 'noTables' | 'tablesFull' | 'noTableFits' | 'review';

const UNSEATED: Readonly<Record<string, UnseatedKey>> = {
  SEATING_VENUE_CAPACITY: 'venueFull',
  SEATING_FAMILY_TABLE_FULL: 'householdTableFull',
  SEATING_NO_TABLES: 'noTables',
  SEATING_TABLES_FULL: 'tablesFull',
  SEATING_NO_TABLE_FITS: 'noTableFits',
  SEATING_UNAVAILABLE: 'review',
};

/** Our words for an unseated household's display code (`localized-seating.ts`). */
export function unseatedKey(code: string | null): UnseatedKey | null {
  return code !== null && Object.hasOwn(UNSEATED, code) ? (UNSEATED[code] ?? null) : null;
}

/**
 * About three minutes: soon at first, as most runs end within seconds, then every five seconds. A
 * run outlives the page that started it; the page offers to look again rather than poll on.
 */
export const POLL_DELAYS: readonly number[] = [1000, 2000, 3000, ...Array<number>(35).fill(5000)];

interface FollowOptions {
  read: () => Promise<SeatingJob>;
  /** Each run read, so the page can say its phase. */
  onRead: (job: SeatingJob) => void;
  wait: (ms: number, signal: AbortSignal) => Promise<void>;
  signal: AbortSignal;
  delays?: readonly number[];
}

/** Reads the run again until it ends; `undefined` when the waits ran out or the page left. */
export function followJob({
  read,
  onRead,
  wait,
  signal,
  delays = POLL_DELAYS,
}: FollowOptions): Promise<SeatingJob | undefined> {
  return pollUntil({
    read: async () => {
      const job = await read();
      if (!signal.aborted) onRead(job);
      return job;
    },
    isDone: (job) => !isActive(job),
    delays,
    wait,
    signal,
  });
}
