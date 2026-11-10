import type { Recovery, Snapshot } from './types';

/** The worker's attempts in all (`EXPORT_ATTEMPTS`), crash recovery included. */
export const ATTEMPTS = 3;

/** The history the API gives: the event's newest fifty (docs/API.md §6). */
export const NEWEST = 50;

/**
 * What the page says of an export (design PD-75). A withdrawn file says so whatever its status: an
 * erasure revokes it, and a revoked file is never offered again. A completed one the server no
 * longer offers has expired.
 */
export type SnapshotState =
  'waiting' | 'making' | 'retrying' | 'ready' | 'expired' | 'withdrawn' | 'failed';

export function snapshotState(snapshot: Snapshot): SnapshotState {
  if (snapshot.revokedAt !== null) return 'withdrawn';
  switch (snapshot.status) {
    case 'COMPLETED':
      return snapshot.isDownloadable ? 'ready' : 'expired';
    case 'FAILED':
      return 'failed';
    case 'RUNNING':
      return 'making';
    case 'QUEUED':
      return snapshot.attempts > 0 ? 'retrying' : 'waiting';
  }
}

export function isActive(snapshot: Snapshot): boolean {
  const state = snapshotState(snapshot);
  return state === 'waiting' || state === 'making' || state === 'retrying';
}

export function countActive(snapshots: readonly Snapshot[]): number {
  return snapshots.filter(isActive).length;
}

/** The attempt under way, or the next one for a snapshot sent back to the queue. */
export function attemptOf(snapshot: Snapshot): number {
  const attempt = snapshot.status === 'QUEUED' ? snapshot.attempts + 1 : snapshot.attempts;
  return Math.min(Math.max(attempt, 1), ATTEMPTS);
}

export type FailureKey =
  'generation' | 'stopped' | 'erased' | 'tooLarge' | 'tooLargeForFormat' | 'accessLost' | 'storage';

/**
 * The export worker's codes we word ourselves (`export-runner.ts`, `export-queue.ts`,
 * `export-privacy.ts`; docs/API.md §6, FR-59), each saying what to do. Any other is shown in the
 * backend's own sentence, which comes in the page's language.
 */
const FAILURES: Readonly<Record<string, FailureKey>> = {
  GENERATION_FAILED: 'generation',
  LEASE_EXHAUSTED: 'stopped',
  SUBJECT_ERASED: 'erased',
  INPUT_LIMIT_EXCEEDED: 'tooLarge',
  OUTPUT_LIMIT_EXCEEDED: 'tooLargeForFormat',
  ACCESS_REVOKED: 'accessLost',
  STORAGE_UNAVAILABLE: 'storage',
};

export function failureKey(reason: string | null): FailureKey | null {
  return reason !== null && Object.hasOwn(FAILURES, reason) ? (FAILURES[reason] ?? null) : null;
}

/**
 * A line beside "Make it again" when the backend's action asks for someone else; RETRY and
 * REGENERATE are the press itself, and WAIT is the progress line.
 */
export type Advice = 'support' | 'access';

export function adviceOf(recovery: Recovery | null): Advice | null {
  if (recovery?.action === 'CONTACT_SUPPORT') return 'support';
  return recovery?.action === 'REQUEST_ACCESS' ? 'access' : null;
}

/**
 * What a row that has ended offers (FR-59, design PD-75): making it again, unless that would fail
 * the same way. An event too large for the report, or a CSV too large, offers nothing; another
 * format too large is offered as a CSV. A file stopped because its maker lost access is made again
 * like any other: the viewer may not be its maker (the list is the whole event's, FR-61), and a
 * viewer who can't see contacts is offered a copy without them when that is refused (PD-76).
 */
export type NextStep = 'again' | 'otherFormat' | 'none';

export function nextStepOf(snapshot: Snapshot): NextStep {
  switch (snapshot.failureReason) {
    case 'INPUT_LIMIT_EXCEEDED':
      return 'none';
    case 'OUTPUT_LIMIT_EXCEEDED':
      return snapshot.format === 'CSV' ? 'none' : 'otherFormat';
    default:
      return 'again';
  }
}
