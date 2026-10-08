import { DataSubjectRequestKind, DataSubjectRequestStatus } from '@prisma/client';

/**
 * How a data-subject request may move.
 *
 * Forward only. A completed request reopened would restart a legal clock that
 * was already answered; an erasure marked completed by hand would report an
 * erasure that never happened — so exports and erasures are completed only by
 * carrying them out. A rectification is the exception: it is applied by
 * editing the record, so closing it by hand is the only way to finish it.
 */
const { RECEIVED, VERIFYING, IN_PROGRESS, COMPLETED, REJECTED } = DataSubjectRequestStatus;

const NEXT: Record<DataSubjectRequestStatus, readonly DataSubjectRequestStatus[]> = {
  [RECEIVED]: [VERIFYING, IN_PROGRESS, REJECTED],
  [VERIFYING]: [IN_PROGRESS, REJECTED],
  [IN_PROGRESS]: [REJECTED, COMPLETED],
  [COMPLETED]: [],
  [REJECTED]: [],
};

export function statusChangeProblem(
  kind: DataSubjectRequestKind,
  from: DataSubjectRequestStatus,
  to: DataSubjectRequestStatus,
): string | null {
  if (from === to) return null;
  if (!NEXT[from].includes(to)) {
    return `status: a request that is ${from} cannot become ${to}`;
  }
  if (to === COMPLETED && kind !== DataSubjectRequestKind.RECTIFICATION) {
    return `status: an ${kind} is completed by carrying it out — POST /privacy/requests/:id/fulfil`;
  }
  return null;
}
