import { Logger } from '@nestjs/common';
import { DataSubjectRequestKind, DataSubjectRequestStatus, PrismaClient } from '@prisma/client';
import { Sentry } from '../../../src/infra/observability/sentry';
import { PrivacyService } from '../../../src/modules/privacy/privacy.service';
import { DAY_MS, privacyService } from '../../fixtures/areas/privacy.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

jest.mock('../../../src/infra/observability/sentry', () => ({
  ...jest.requireActual<object>('../../../src/infra/observability/sentry'),
  Sentry: { captureMessage: jest.fn() },
}));

/**
 * GDPR Article 12 gives a month from receipt. The clock is only a clock if
 * something reads it: overdue requests are a breach to disclose, those due
 * within a week are a day's work to schedule, and closed ones are neither.
 */
describe('The data-subject request deadline (integration coverage)', () => {
  let prisma: PrismaClient;
  let service: PrivacyService;
  const captureMessage = Sentry.captureMessage as jest.Mock;
  // Fixed rather than read from the clock: every boundary below is relative to it.
  const NOW = new Date('2026-10-31T09:00:00.000Z');
  const HOUR_MS = 3_600_000;

  beforeAll(() => {
    prisma = testPrisma();
    ({ service } = privacyService(prisma));
  });
  let loggedError: jest.SpyInstance;
  let loggedWarning: jest.SpyInstance;

  beforeEach(async () => {
    captureMessage.mockClear();
    loggedError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    loggedWarning = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await resetTestDatabase();
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => disconnectTestDatabase());

  const requestDue = (status: DataSubjectRequestStatus, dueAt: Date, subjectEmail: string) =>
    prisma.dataSubjectRequest.create({
      data: {
        kind: DataSubjectRequestKind.ERASURE, status, subjectEmail, dueAt,
        // The schema requires a deadline after receipt.
        requestedAt: new Date(dueAt.getTime() - 30 * DAY_MS),
      },
    });

  const seedQueue = async () => ({
    overdue: await requestDue(DataSubjectRequestStatus.RECEIVED, new Date(NOW.getTime() - HOUR_MS), 'overdue@test.local'),
    inThreeDays: await requestDue(DataSubjectRequestStatus.VERIFYING, new Date(NOW.getTime() + 3 * DAY_MS), 'soon@test.local'),
    inOneDay: await requestDue(DataSubjectRequestStatus.IN_PROGRESS, new Date(NOW.getTime() + DAY_MS), 'sooner@test.local'),
    inTenDays: await requestDue(DataSubjectRequestStatus.IN_PROGRESS, new Date(NOW.getTime() + 10 * DAY_MS), 'later@test.local'),
    completedOverdue: await requestDue(DataSubjectRequestStatus.COMPLETED, new Date(NOW.getTime() - 5 * DAY_MS), 'done@test.local'),
    rejectedSoon: await requestDue(DataSubjectRequestStatus.REJECTED, new Date(NOW.getTime() + DAY_MS), 'rejected@test.local'),
  });

  it('separates the overdue from those due within a week, soonest first, ignoring closed and later ones', async () => {
    const seeded = await seedQueue();

    const { overdue, dueSoon } = await service.dueSoon(NOW);

    expect(overdue.map((request) => request.id)).toEqual([seeded.overdue.id]);
    expect(dueSoon.map((request) => request.id)).toEqual([seeded.inOneDay.id, seeded.inThreeDays.id]);
  });

  it.each([
    ['exactly now', 0, 'overdue'],
    ['one millisecond from now', 1, 'dueSoon'],
    ['exactly seven days from now', 7 * DAY_MS, 'dueSoon'],
  ] as const)('counts a request due %s as %s', async (_label, offsetMs, bucket) => {
    const request = await requestDue(DataSubjectRequestStatus.RECEIVED, new Date(NOW.getTime() + offsetMs), 'edge@test.local');

    const result = await service.dueSoon(NOW);

    expect(result[bucket].map((row) => row.id)).toEqual([request.id]);
  });

  it('leaves a request due a millisecond past the week out of the warning', async () => {
    await requestDue(DataSubjectRequestStatus.RECEIVED, new Date(NOW.getTime() + 7 * DAY_MS + 1), 'later@test.local');

    expect(await service.dueSoon(NOW)).toEqual({ overdue: [], dueSoon: [] });
  });

  it('raises an overdue request to Sentry as an error, logs it by reference, and reports both counts', async () => {
    const seeded = await seedQueue();

    const report = await service.reportDueRequests(NOW);

    expect(report).toEqual({ overdue: 1, dueSoon: 2 });
    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(captureMessage).toHaveBeenCalledWith('1 data-subject request(s) past the GDPR deadline', 'error');
    expect(loggedError).toHaveBeenCalledTimes(1);
    expect(loggedError).toHaveBeenCalledWith(expect.stringContaining(`${seeded.overdue.id} (ERASURE)`));
    // The reference is enough to act on; the address stays out of the log.
    expect(String(loggedError.mock.calls[0][0])).not.toContain('overdue@test.local');
    expect(loggedWarning).toHaveBeenCalledWith(expect.stringContaining('2 data-subject request(s) due within 7 days'));
  });

  it('raises nothing when requests are only due soon', async () => {
    await requestDue(DataSubjectRequestStatus.RECEIVED, new Date(NOW.getTime() + DAY_MS), 'soon@test.local');

    const report = await service.reportDueRequests(NOW);

    expect(report).toEqual({ overdue: 0, dueSoon: 1 });
    expect(captureMessage).not.toHaveBeenCalled();
    expect(loggedError).not.toHaveBeenCalled();
  });

  it('stays silent when nothing is overdue or due within the week', async () => {
    await requestDue(DataSubjectRequestStatus.RECEIVED, new Date(NOW.getTime() + 10 * DAY_MS), 'later@test.local');

    expect(await service.reportDueRequests(NOW)).toEqual({ overdue: 0, dueSoon: 0 });
    expect(captureMessage).not.toHaveBeenCalled();
    expect(loggedError).not.toHaveBeenCalled();
    expect(loggedWarning).not.toHaveBeenCalled();
  });
});
