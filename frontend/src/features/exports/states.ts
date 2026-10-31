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

export type FailureKey = 'generation' | 'stopped' | 'erased';

/**
 * The export worker's codes (`export-runner.ts`, `export-queue.ts`, `export-privacy.ts`). Every
 * failure of reading, rendering, storing or permission is `GENERATION_FAILED` (FR-59). An unknown
 * code is shown in the backend's own sentence, which comes in the page's language.
 */
const FAILURES: Readonly<Record<string, FailureKey>> = {
  GENERATION_FAILED: 'generation',
  LEASE_EXHAUSTED: 'stopped',
  SUBJECT_ERASED: 'erased',
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
