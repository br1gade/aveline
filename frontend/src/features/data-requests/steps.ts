import type { DataRequest, RequestKind, RequestStatus } from './types';

export type RequestStep =
  'verify' | 'confirm' | 'export' | 'deliver' | 'erase' | 'close' | 'reject';

type AskedRequest = Pick<
  DataRequest,
  'kind' | 'status' | 'subjectEmail' | 'erasureAppliedAt' | 'exportGenerationId'
>;

const CARRY_OUT: Readonly<Record<RequestKind, RequestStep>> = {
  EXPORT: 'export',
  ERASURE: 'erase',
  RECTIFICATION: 'close',
};

export function isClosed(status: RequestStatus): boolean {
  return status === 'COMPLETED' || status === 'REJECTED';
}

/** Closing a correction carries nothing out, so it alone can go on with no address. */
function canGoOnHere({ kind, subjectEmail }: Pick<AskedRequest, 'kind' | 'subjectEmail'>): boolean {
  return kind === 'RECTIFICATION' || subjectEmail !== null;
}

/** Waiting for a screen enquiries don't have yet (design PD-168). */
export function isStuckWithoutAddress(request: AskedRequest): boolean {
  return !isClosed(request.status) && !canGoOnHere(request);
}

/**
 * What may be done next to a request, as `request-status.ts` allows. Nothing is carried out until
 * someone has said who the requester is, since the form is public (docs/API.md §6). An erasure already
 * applied can only be finished, as the backend refuses rejecting it (FR-131). An export made can be
 * made again, and closes once its delivery is confirmed (FR-128). With no address, as from an enquiry,
 * an export or an erasure goes no further here, as an erasure is confirmed by typing it.
 */
export function nextSteps(request: AskedRequest): readonly RequestStep[] {
  const { kind, status, subjectEmail, erasureAppliedAt } = request;
  if (isClosed(status)) return [];
  if (erasureAppliedAt) return subjectEmail ? ['erase'] : [];
  if (!canGoOnHere(request)) return ['reject'];
  if (status === 'RECEIVED') return ['verify', 'confirm', 'reject'];
  if (status === 'VERIFYING') return ['confirm', 'reject'];
  if (kind === 'EXPORT' && request.exportGenerationId) return ['export', 'deliver', 'reject'];
  return [CARRY_OUT[kind], 'reject'];
}
