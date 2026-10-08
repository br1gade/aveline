import { DataSubjectRequestKind as Kind, DataSubjectRequestStatus as Status } from '@prisma/client';
import { statusChangeProblem } from './request-status';

describe('statusChangeProblem', () => {
  it.each([
    [Status.RECEIVED, Status.VERIFYING],
    [Status.RECEIVED, Status.IN_PROGRESS],
    [Status.VERIFYING, Status.IN_PROGRESS],
    [Status.IN_PROGRESS, Status.REJECTED],
    [Status.IN_PROGRESS, Status.IN_PROGRESS],
  ])('lets an erasure move from %s to %s', (from, to) => {
    expect(statusChangeProblem(Kind.ERASURE, from, to)).toBeNull();
  });

  it.each([
    [Status.COMPLETED, Status.RECEIVED],
    [Status.REJECTED, Status.IN_PROGRESS],
    [Status.IN_PROGRESS, Status.VERIFYING],
  ])('refuses moving backwards from %s to %s', (from, to) => {
    expect(statusChangeProblem(Kind.ERASURE, from, to)).toMatch(/^status: /);
  });

  it.each([Kind.ERASURE, Kind.EXPORT])('refuses completing an %s by hand', (kind) => {
    expect(statusChangeProblem(kind, Status.IN_PROGRESS, Status.COMPLETED)).toMatch(/fulfil/);
  });

  it('lets a rectification be closed by hand, but only once in progress', () => {
    expect(statusChangeProblem(Kind.RECTIFICATION, Status.IN_PROGRESS, Status.COMPLETED)).toBeNull();
    expect(statusChangeProblem(Kind.RECTIFICATION, Status.RECEIVED, Status.COMPLETED)).not.toBeNull();
  });
});
