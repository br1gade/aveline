import { isApiError } from '@/api/errors';
import { problemFrom, type Problem } from '@/api/problems';

import type { AttendanceMode } from './types';

/**
 * Changing how guests answer (docs/API.md §6, "Attendance modes"; design PD-53). The change is
 * previewed first, since it sets every answer back to "not answered", and confirmed with what the
 * preview returned. Interim types until FR-1, read by naming each field kept.
 */

export interface AttendanceImpact {
  guests: number;
  /** Answers given so far, which go back to "not answered". */
  responses: number;
  /** Seated guests keep their seats as reservations until they answer again. */
  seatedGuests: number;
}

export interface AttendancePreview {
  mode: AttendanceMode;
  expectedRevision: number;
  /** A fingerprint of the event as previewed: a change meanwhile makes the confirmation fail. */
  previewToken: string;
  affected: AttendanceImpact;
}

export interface AttendanceChanged {
  mode: AttendanceMode;
  revision: number;
  /** The existing notify-changes call, when there is an invitation to tell guests about. */
  notificationPath: string | null;
}

interface PreviewWire {
  mode: AttendanceMode;
  expectedRevision: number;
  previewToken: string;
  affected: { guests: number; responses: number; seatedGuests: number };
}

interface ChangedWire {
  mode: AttendanceMode;
  revision: number;
  notice: { notificationPath: string | null };
}

export function readPreview(wire: PreviewWire): AttendancePreview {
  const { guests, responses, seatedGuests } = wire.affected;
  return {
    mode: wire.mode,
    expectedRevision: wire.expectedRevision,
    previewToken: wire.previewToken,
    affected: { guests, responses, seatedGuests },
  };
}

export function readChanged(wire: ChangedWire): AttendanceChanged {
  return {
    mode: wire.mode,
    revision: wire.revision,
    notificationPath: wire.notice.notificationPath,
  };
}

export type { ChangedWire, PreviewWire };

/** There are two ways to answer; a change is always to the other one. */
export function otherMode(mode: AttendanceMode): AttendanceMode {
  return mode === 'EVENT_WIDE' ? 'PER_VENUE' : 'EVENT_WIDE';
}

/**
 * What a refusal means for the page. A preview gone stale (`expectedRevision:`, `previewToken:`)
 * or a retry id used for another change (`transitionId:`) means preview again; `mode:` names a
 * per-venue change with no venue guests see, or a mode already in use, which reloads the page.
 */
export type AttendanceRefusal =
  | { kind: 'stale' }
  | { kind: 'noVenue' }
  | { kind: 'sameMode' }
  | { kind: 'problem'; problem: Problem };

const NO_VENUE = /^mode: per-venue attendance needs a guest-facing venue/;
const SAME_MODE = /^mode: already using/;
const STALE = /^(expectedRevision|previewToken|transitionId): /;

function refusalByText(messages: readonly string[]): AttendanceRefusal | null {
  if (messages.some((message) => STALE.test(message))) return { kind: 'stale' };
  if (messages.some((message) => NO_VENUE.test(message))) return { kind: 'noVenue' };
  if (messages.some((message) => SAME_MODE.test(message))) return { kind: 'sameMode' };
  return null;
}

export function attendanceRefusal(error: unknown): AttendanceRefusal {
  const isKnown = isApiError(error) && (error.status === 400 || error.status === 409);
  const byText = isKnown ? refusalByText(error.messages) : null;
  return byText ?? { kind: 'problem', problem: problemFrom(error) };
}
