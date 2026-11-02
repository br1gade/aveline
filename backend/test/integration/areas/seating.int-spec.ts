import { Logger } from '@nestjs/common';
import { PlatformRole, PrismaClient, RsvpStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { CacheService } from '../../../src/infra/cache/cache.service';
import { AttendancePolicyService } from '../../../src/modules/events/attendance-policy.service';
import { VenuesService } from '../../../src/modules/design/venues.service';
import { OrganizationsService } from '../../../src/modules/organizations/organizations.service';
import { OrganizationReviewsService } from '../../../src/modules/organizations/organization-reviews.service';
import { HostRsvpService } from '../../../src/modules/rsvp/host-rsvp.service';
import { RsvpConfirmerService } from '../../../src/modules/invitations/sending/rsvp-confirmer.service';
import { SeatingJobsService } from '../../../src/modules/seating/jobs/seating-jobs.service';
import { SeatingPlanner } from '../../../src/modules/seating/jobs/seating-planner';
import { SeatingQueue } from '../../../src/modules/seating/jobs/seating-queue';
import { SeatingRunner } from '../../../src/modules/seating/jobs/seating-runner';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { seedEvent } from '../../fixtures/event.fixture';
import { runAutomaticSeating, seatingTestJob } from '../../fixtures/seating-job.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

/**
 * Automatic seating outcomes the worker promises in docs/API.md ("Archived
 * events cannot start or apply a job", attempt bounds, input bounds) and
 * backend/docs/SEATING_WORKER.md.
 */
describe('Automatic seating worker outcomes (integration)', () => {
  let prisma: PrismaClient;
  let database: PrismaService;
  let jobs: SeatingJobsService;
  let queue: SeatingQueue;
  let runner: SeatingRunner;
  let planner: SeatingPlanner;
  beforeAll(() => {
    prisma = testPrisma();
    database = prisma as unknown as PrismaService;
  });
  beforeEach(async () => {
    await resetTestDatabase();
    jobs = new SeatingJobsService(database);
    queue = new SeatingQueue(database);
    planner = new SeatingPlanner();
    runner = new SeatingRunner(database, queue, planner);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => disconnectTestDatabase());

  const setup = async () => {
    const event = await seedEvent(prisma);
    const user = await prisma.user.create({ data: { name: 'Coordinator', email: `${randomUUID()}@test.local`, eventMemberships: { create: { eventId: event.eventId, role: 'COORDINATOR' } } } });
    const guest = await prisma.guest.findUniqueOrThrow({ where: { token: event.primaryGuestToken } });
    await prisma.rsvp.update({ where: { guestId: guest.id }, data: { status: 'ATTENDING' } });
    const table = await prisma.table.create({ data: { eventId: event.eventId, name: 'One', capacity: 3 } });
    return { ...event, userId: user.id, guest, table };
  };
  const start = (event: { eventId: string; userId: string }) => jobs.create(event.eventId, event.userId, { idempotencyKey: randomUUID() });
  /** Runs `change` after the planner has produced its plan and before the worker applies it. */
  const afterPlanning = (change: () => Promise<unknown>) => {
    const original = planner.plan.bind(planner);
    return jest.spyOn(planner, 'plan').mockImplementationOnce(async (input) => {
      const plan = await original(input);
      await change();
      return plan;
    });
  };

  describe('requester and event standing', () => {
    it.each([
      ['removed from the event', (event: Awaited<ReturnType<typeof setup>>) => prisma.eventMembership.deleteMany({ where: { userId: event.userId } })],
      ['deactivated', (event: Awaited<ReturnType<typeof setup>>) => prisma.user.update({ where: { id: event.userId }, data: { isActive: false } })],
      ['downgraded to viewer', (event: Awaited<ReturnType<typeof setup>>) => prisma.eventMembership.updateMany({ where: { userId: event.userId }, data: { role: 'VIEWER' } })],
    ])('fails terminally with ACCESS_REVOKED and writes no seats when the requester is %s during computation', async (_label, change) => {
      const event = await setup();
      const job = await start(event);
      afterPlanning(() => change(event));

      await runner.runOne();

      expect(await jobs.findOne(event.eventId, job.id)).toMatchObject({ status: 'FAILED', failureReason: 'ACCESS_REVOKED', attempts: 1, result: null });
      expect(await prisma.seat.count()).toBe(0);
      expect(await queue.claim()).toBeNull();
    });

    it('fails terminally with EVENT_UNAVAILABLE when the event is archived during computation', async () => {
      const event = await setup();
      const job = await start(event);
      afterPlanning(() => prisma.event.update({ where: { id: event.eventId }, data: { status: 'ARCHIVED' } }));

      await runner.runOne();

      expect(await jobs.findOne(event.eventId, job.id)).toMatchObject({ status: 'FAILED', failureReason: 'EVENT_UNAVAILABLE', attempts: 1, result: null });
      expect(await prisma.seat.count()).toBe(0);
    });

    it('fails a queued job with EVENT_UNAVAILABLE without planning when the event was archived before it was claimed', async () => {
      const event = await setup();
      const job = await start(event);
      await prisma.event.update({ where: { id: event.eventId }, data: { status: 'ARCHIVED' } });
      const computation = jest.spyOn(planner, 'plan');

      await runner.runOne();

      expect(computation).not.toHaveBeenCalled();
      expect(await jobs.findOne(event.eventId, job.id)).toMatchObject({ status: 'FAILED', failureReason: 'EVENT_UNAVAILABLE', attempts: 1, result: null });
      expect(await prisma.seat.count()).toBe(0);
    });
  });

  describe('organization departure and closure', () => {
    const organizationFixture = async (platformRole: PlatformRole) => {
      const event = await seedEvent(prisma);
      await prisma.table.create({ data: { eventId: event.eventId, name: 'Family', capacity: 4 } });
      await prisma.rsvp.updateMany({ where: { guest: { eventId: event.eventId } }, data: { status: 'ATTENDING' } });
      const worker = await seatingTestJob(prisma, event.eventId);
      const user = await prisma.user.update({ where: { email: `seating-${event.eventId}@test.local` }, data: { platformRole } });
      const organization = await prisma.organization.findFirstOrThrow({ where: { events: { some: { id: event.eventId } } } });
      const owner = await prisma.user.create({ data: { name: 'Owner', email: `owner-${randomUUID()}@test.local` } });
      await prisma.organizationMembership.createMany({ data: [
        { organizationId: organization.id, userId: owner.id, role: 'OWNER' },
        { organizationId: organization.id, userId: user.id, role: 'MEMBER' },
      ] });
      const actor = { userId: owner.id, email: owner.email, platformRole: PlatformRole.NONE };
      return { ...event, worker, user, organization, actor };
    };

    it('records ACCESS_REVOKED when a customer requester leaves the organization during computation', async () => {
      const event = await organizationFixture(PlatformRole.NONE);
      const organizations = new OrganizationsService(database);
      const plan = event.worker.planner.plan.bind(event.worker.planner);
      jest.spyOn(event.worker.planner, 'plan').mockImplementationOnce(async (input) => {
        const result = await plan(input);
        await organizations.removeMember(event.organization.id, event.actor, { userId: event.user.id, expectedRevision: 0 });
        return result;
      });

      await event.worker.runner.runOne();

      expect(await prisma.seatingJob.findUniqueOrThrow({ where: { id: event.worker.job.id } })).toMatchObject({ status: 'FAILED', failureReason: 'ACCESS_REVOKED', result: null });
      expect(await prisma.seat.count()).toBe(0);
    });

    it('records ACCESS_REVOKED on a queued job when its organization is closed, and leaves nothing to claim', async () => {
      const event = await organizationFixture(PlatformRole.ADMIN);
      const reviews = new OrganizationReviewsService(database);
      const review = await reviews.request(event.organization.id, event.actor, { expectedRevision: 0 });

      await reviews.resolve({ userId: event.user.id, email: event.user.email, platformRole: PlatformRole.ADMIN }, review.reviewId, { decision: 'CLOSE', expectedRevision: 0 });

      expect(await prisma.seatingJob.findUniqueOrThrow({ where: { id: event.worker.job.id } })).toMatchObject({ status: 'FAILED', failureReason: 'ACCESS_REVOKED' });
      expect(await event.worker.runner.runOne()).toBe(false);
      expect(await prisma.seat.count()).toBe(0);
    });
  });

  describe('attempt bound', () => {
    /** Applies the job's backoff by hand so the next claim can take it now. */
    const makeDue = (id: string) => prisma.seatingJob.update({ where: { id }, data: { nextAttemptAt: new Date(0) } });
    const runTimed = async () => {
      const before = Date.now();
      await runner.runOne();
      return { before, after: Date.now() };
    };

    it('backs off 2 s then 4 s between repeated conflicts and ends FAILED with STATE_CHANGED on the third attempt', async () => {
      const event = await setup();
      const job = await start(event);
      const original = planner.plan.bind(planner);
      let capacity = event.table.capacity;
      jest.spyOn(planner, 'plan').mockImplementation(async (input) => {
        const plan = await original(input);
        capacity += 1;
        await prisma.table.update({ where: { id: event.table.id }, data: { capacity } });
        return plan;
      });

      for (const backoff of [2000, 4000]) {
        const { before, after } = await runTimed();
        const retrying = await prisma.seatingJob.findUniqueOrThrow({ where: { id: job.id } });
        expect(retrying).toMatchObject({ status: 'QUEUED', failureReason: 'STATE_CHANGED', completedAt: null });
        expect(retrying.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(before + backoff);
        expect(retrying.nextAttemptAt.getTime()).toBeLessThanOrEqual(after + backoff);
        await makeDue(job.id);
      }
      await runner.runOne();

      expect(await jobs.findOne(event.eventId, job.id)).toMatchObject({ status: 'FAILED', failureReason: 'STATE_CHANGED', attempts: 3, result: null });
      expect(await queue.claim()).toBeNull();
      expect(await prisma.seat.count()).toBe(0);
      expect(await start(event)).toMatchObject({ status: 'QUEUED', attempts: 0 });
    });

    it('retries an unexpected planning error and ends FAILED with PLANNING_FAILED after three attempts', async () => {
      const event = await setup();
      const job = await start(event);
      jest.spyOn(planner, 'plan').mockRejectedValue(new Error('planner crashed'));

      await runner.runOne();
      expect(await jobs.findOne(event.eventId, job.id)).toMatchObject({ status: 'QUEUED', failureReason: 'PLANNING_FAILED', attempts: 1 });
      await makeDue(job.id);
      await runner.runOne();
      await makeDue(job.id);
      await runner.runOne();

      expect(await jobs.findOne(event.eventId, job.id)).toMatchObject({ status: 'FAILED', failureReason: 'PLANNING_FAILED', attempts: 3 });
      expect(await queue.claim()).toBeNull();
    });
  });

  describe('input and computation bounds', () => {
    const addGuests = (event: { eventId: string; householdId: string }, count: number) =>
      prisma.guest.createMany({ data: Array.from({ length: count }, (_, index) => ({
        eventId: event.eventId, householdId: event.householdId, firstName: `Bulk ${index}`, token: `bulk-${index}-${event.eventId}`,
      })) });

    it('fails an event of 5,001 guests with INPUT_LIMIT_EXCEEDED before planning', async () => {
      const event = await setup();
      await addGuests(event, 5000);
      const job = await start(event);
      const computation = jest.spyOn(planner, 'plan');

      await runner.runOne();

      expect(computation).not.toHaveBeenCalled();
      expect(await jobs.findOne(event.eventId, job.id)).toMatchObject({ status: 'FAILED', failureReason: 'INPUT_LIMIT_EXCEEDED', attempts: 1 });
      expect(await prisma.seat.count()).toBe(0);
    });

    it('plans an event of exactly 5,000 guests', async () => {
      const event = await setup();
      await addGuests(event, 4999);
      const job = await start(event);

      await runner.runOne();

      expect(await jobs.findOne(event.eventId, job.id)).toMatchObject({ status: 'COMPLETED', result: { seated: 1 } });
    });

    it('plans an arrangement of exactly 500 tables', async () => {
      const event = await setup();
      await prisma.table.createMany({ data: Array.from({ length: 499 }, (_, index) => ({ eventId: event.eventId, name: `Extra ${index}`, capacity: 2 })) });
      const job = await start(event);

      await runner.runOne();

      expect(await jobs.findOne(event.eventId, job.id)).toMatchObject({ status: 'COMPLETED', result: { seated: 1 } });
    });

    /** Makes the clock read `elapsed` ms later once the planner returns, as if computing had taken that long. */
    const planningTakes = (elapsed: number) => afterPlanning(() => {
      const realNow = Date.now.bind(Date);
      jest.spyOn(Date, 'now').mockImplementation(() => realNow() + elapsed);
      return Promise.resolve();
    });

    it('fails with PLANNING_LIMIT_EXCEEDED and writes no seats when computation takes over 30 seconds', async () => {
      const event = await setup();
      const job = await start(event);
      planningTakes(30_001);

      await runner.runOne();

      expect(await jobs.findOne(event.eventId, job.id)).toMatchObject({ status: 'FAILED', failureReason: 'PLANNING_LIMIT_EXCEEDED', attempts: 1, result: null });
      expect(await prisma.seat.count()).toBe(0);
      expect(await queue.claim()).toBeNull();
    });

    it('applies a plan whose computation took just under 30 seconds', async () => {
      const event = await setup();
      const job = await start(event);
      planningTakes(29_000);

      await runner.runOne();

      expect(await jobs.findOne(event.eventId, job.id)).toMatchObject({ status: 'COMPLETED', failureReason: null, result: { seated: 1 } });
      expect(await prisma.seat.findMany({ select: { guestId: true } })).toEqual([{ guestId: event.guest.id }]);
    });
  });

  describe('who is planned', () => {
    const singleGuestHousehold = async (eventId: string, status: RsvpStatus) => {
      const household = await prisma.household.create({ data: { eventId, name: `${status} family`, seatsAllotted: 1 } });
      return prisma.guest.create({ data: { eventId, householdId: household.id, firstName: status, token: randomUUID(), rsvp: { create: { status } } } });
    };

    it('seats only attending households event-wide, leaving undecided, pending and declined guests unseated despite spare chairs', async () => {
      const event = await setup();
      await prisma.table.update({ where: { id: event.table.id }, data: { capacity: 10 } });
      await Promise.all(([RsvpStatus.UNDECIDED, RsvpStatus.PENDING, RsvpStatus.DECLINED]).map((status) => singleGuestHousehold(event.eventId, status)));

      const result = await runAutomaticSeating(prisma, event.eventId);

      expect(result).toMatchObject({ seated: 1, households: 1, unseated: [] });
      expect(await prisma.seat.findMany({ select: { guestId: true } })).toEqual([{ guestId: event.guest.id }]);
    });

    describe('per-venue attendance', () => {
      const cache = { invalidateInvitation: jest.fn().mockResolvedValue(undefined) } as unknown as CacheService;
      const confirmer = { confirm: jest.fn().mockResolvedValue(undefined) } as unknown as RsvpConfirmerService;
      const perVenue = async () => {
        const event = await seedEvent(prisma, { seatsAllotted: 4 });
        const primary = await prisma.guest.findUniqueOrThrow({ where: { token: event.primaryGuestToken } });
        const other = await singleGuestHousehold(event.eventId, RsvpStatus.PENDING);
        const hall = await prisma.venue.findFirstOrThrow({ where: { eventId: event.eventId } });
        const church = await new VenuesService(database, cache).create(event.eventId, { role: 'CEREMONY', name: 'Church', address: '2 Test St' });
        const [hallTable, churchTable, legacyTable] = await Promise.all([hall.id, church.id, null].map((venueId, index) =>
          prisma.table.create({ data: { eventId: event.eventId, venueId, name: `Table ${index}`, capacity: 4 } })));
        const policies = new AttendancePolicyService(database, cache);
        const preview = await policies.preview(event.eventId, 'PER_VENUE');
        await policies.change(event.eventId, { ...preview.request, transitionId: randomUUID() });
        const host = new HostRsvpService(database, confirmer);
        await host.record(event.eventId, primary.id, { attendanceRevision: 2, venueAttendance: [{ venueId: hall.id, status: 'ATTENDING' }, { venueId: church.id, status: 'DECLINED' }] });
        await host.record(event.eventId, other.id, { attendanceRevision: 2, venueAttendance: [{ venueId: hall.id, status: 'UNDECIDED' }, { venueId: church.id, status: 'ATTENDING' }] });
        return { ...event, primary, other, hallTable, churchTable, legacyTable };
      };

      it('seats at a venue only the guests who confirmed that venue, not those undecided about it', async () => {
        const event = await perVenue();

        expect(await runAutomaticSeating(prisma, event.eventId, event.hallTable.arrangementId)).toMatchObject({ seated: 1 });
        expect(await runAutomaticSeating(prisma, event.eventId, event.churchTable.arrangementId)).toMatchObject({ seated: 1 });

        expect(await prisma.seat.findMany({ where: { tableId: event.hallTable.id }, select: { guestId: true } })).toEqual([{ guestId: event.primary.id }]);
        expect(await prisma.seat.findMany({ where: { tableId: event.churchTable.id }, select: { guestId: true } })).toEqual([{ guestId: event.other.id }]);
      });

      it('seats nobody in the unspecified arrangement even when it has free chairs and everyone is attending somewhere', async () => {
        const event = await perVenue();

        expect(await runAutomaticSeating(prisma, event.eventId, event.legacyTable.arrangementId)).toMatchObject({ seated: 0, households: 0 });

        expect(await prisma.seat.count({ where: { tableId: event.legacyTable.id } })).toBe(0);
      });
    });
  });

  describe('worker logs', () => {
    it('logs only the job ID, attempt and failure code, never guest or requester identity', async () => {
      const event = await setup();
      await prisma.guest.update({ where: { id: event.guest.id }, data: { email: 'logged-guest@test.local' } });
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const conflicted = await start(event);
      afterPlanning(() => prisma.rsvp.update({ where: { guestId: event.guest.id }, data: { status: 'DECLINED' } }));
      await runner.runOne();
      await prisma.seatingJob.update({ where: { id: conflicted.id }, data: { status: 'FAILED' } });
      await prisma.rsvp.update({ where: { guestId: event.guest.id }, data: { status: 'ATTENDING' } });
      await start(event);
      afterPlanning(() => prisma.eventMembership.deleteMany({ where: { userId: event.userId } }));
      await runner.runOne();

      const logged = warn.mock.calls.map((call) => call[0] as Record<string, unknown>);
      expect(logged.map((entry) => entry.code)).toEqual(['STATE_CHANGED', 'ACCESS_REVOKED']);
      for (const entry of logged) expect(Object.keys(entry).sort()).toEqual(['attempt', 'code', 'jobId']);
      const text = JSON.stringify(warn.mock.calls);
      for (const secret of [event.primaryGuestToken, 'logged-guest@test.local', event.guest.id, event.userId]) expect(text).not.toContain(secret);
    });
  });
});
