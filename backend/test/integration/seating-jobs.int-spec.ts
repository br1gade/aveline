import { seedSeatingRehearsal } from '../fixtures/seating-rehearsal.fixture';
import { runAutomaticSeating } from '../fixtures/seating-job.fixture';
import { withdrawTicketGuests } from '../../src/modules/ticketing/cancellation-state';
import { eraseSubject } from '../../src/modules/privacy/erasure';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AttendancePolicyService } from '../../src/modules/events/attendance-policy.service';
import { CacheService } from '../../src/infra/cache/cache.service';
import { startSeatingWorker, waitForSeatingState } from '../fixtures/seating-worker.fixture';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SeatingJobsService } from '../../src/modules/seating/jobs/seating-jobs.service';
import { SeatingQueue } from '../../src/modules/seating/jobs/seating-queue';
import { SeatingRunner } from '../../src/modules/seating/jobs/seating-runner';
import { SeatingPlanner } from '../../src/modules/seating/jobs/seating-planner';
import { SeatingService } from '../../src/modules/seating/seating.service';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

describe('Durable automatic seating (integration)', () => {
  let prisma: PrismaClient;
  let jobs: SeatingJobsService;
  let queue: SeatingQueue;
  let runner: SeatingRunner;
  let planner: SeatingPlanner;
  beforeAll(() => { prisma = testPrisma(); });
  beforeEach(async () => {
    await resetTestDatabase();
    const database = prisma as unknown as PrismaService;
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
    const venue = await prisma.venue.findFirstOrThrow({ where: { eventId: event.eventId } });
    return { ...event, userId: user.id, guest, table, venueId: venue.id };
  };
  const start = (event: { eventId: string; userId: string }) => jobs.create(event.eventId, event.userId, { idempotencyKey: randomUUID() });

  it('accepts durable work without seating inline and deduplicates only the same intent', async () => {
    const event = await setup();
    const intent = { idempotencyKey: randomUUID() };
    const [first, retry] = await Promise.all([jobs.create(event.eventId, event.userId, intent), jobs.create(event.eventId, event.userId, intent)]);
    expect(first).toMatchObject({ status: 'QUEUED', attempts: 0, result: null, arrangementId: event.table.arrangementId });
    expect(retry.id).toBe(first.id);
    expect(await prisma.seat.count()).toBe(0);
    await expect(start(event)).rejects.toThrow('active seating job');
    await expect(jobs.create(event.eventId, event.userId, intent, `venue:${event.venueId}`)).rejects.toThrow('another arrangement');
  });

  it('applies a household atomically, preserves existing seats and exposes no guest credentials', async () => {
    const event = await setup();
    const member = await prisma.guest.create({ data: { eventId: event.eventId, householdId: event.householdId, firstName: 'Member', token: randomUUID(), rsvp: { create: { status: 'ATTENDING' } } } });
    const manual = new SeatingService(prisma as unknown as PrismaService);
    await manual.assign(event.eventId, { guestId: event.guest.id, tableId: event.table.id });
    const job = await start(event);
    await runner.runOne();
    const completed = await jobs.findOne(event.eventId, job.id);
    expect(completed).toMatchObject({ status: 'COMPLETED', attempts: 1, attendanceRevision: 1, result: { seated: 1, households: 1, unseated: [] } });
    expect(JSON.stringify(completed)).not.toMatch(/token|leaseOwner|leaseUntil|guestIds/);
    expect((await prisma.seat.findUniqueOrThrow({ where: { guestId_arrangementId: { guestId: member.id, arrangementId: event.table.arrangementId } } })).tableId).toBe(event.table.id);
    expect(await prisma.seat.count({ where: { tableId: event.table.id } })).toBe(2);
  });

  it.each(['manual seat', 'table capacity', 'decline', 'guest attribution', 'table deletion', 'late answer', 'venue capacity'] as const)('discards a plan after a concurrent %s instead of applying stale work', async (change) => {
    const event = await setup();
    const job = await start(event);
    const original = planner.plan.bind(planner);
    jest.spyOn(planner, 'plan').mockImplementationOnce(async (input) => {
      const plan = await original(input);
      const changes = {
        'manual seat': () => new SeatingService(prisma as unknown as PrismaService).assign(event.eventId, { guestId: event.guest.id, tableId: event.table.id }),
        'table capacity': () => prisma.table.update({ where: { id: event.table.id }, data: { capacity: 1 } }),
        decline: () => prisma.rsvp.update({ where: { guestId: event.guest.id }, data: { status: 'DECLINED' } }),
        'guest attribution': () => prisma.guest.update({ where: { id: event.guest.id }, data: { attribution: 'SIDE_B' } }),
        'table deletion': () => prisma.table.delete({ where: { id: event.table.id } }),
        'late answer': () => prisma.guest.create({ data: { eventId: event.eventId, householdId: event.householdId, firstName: 'Late', token: randomUUID(), rsvp: { create: { status: 'ATTENDING' } } } }),
        'venue capacity': () => prisma.venue.update({ where: { id: event.venueId }, data: { capacity: 1 } }),
      };
      await changes[change]();
      return plan;
    });
    await runner.runOne();
    expect(await jobs.findOne(event.eventId, job.id)).toMatchObject({ status: 'QUEUED', failureReason: 'STATE_CHANGED', result: null });
    expect(await prisma.seat.count()).toBe(change === 'manual seat' ? 1 : 0);
    await prisma.seatingJob.update({ where: { id: job.id }, data: { nextAttemptAt: new Date(0) } });
    await runner.runOne();
    expect(await jobs.findOne(event.eventId, job.id)).toMatchObject({ status: 'COMPLETED', attempts: 2 });
  });

  it.each(['archive', 'remove member', 'deactivate user'] as const)('refuses to apply after %s even after planning', async (change) => {
    const event = await setup();
    const job = await start(event);
    const original = planner.plan.bind(planner);
    jest.spyOn(planner, 'plan').mockImplementationOnce(async (input) => {
      const plan = await original(input);
      if (change === 'archive') await prisma.event.update({ where: { id: event.eventId }, data: { status: 'ARCHIVED' } });
      if (change === 'remove member') await prisma.eventMembership.deleteMany({ where: { userId: event.userId } });
      if (change === 'deactivate user') await prisma.user.update({ where: { id: event.userId }, data: { isActive: false } });
      return plan;
    });
    await runner.runOne();
    expect(await jobs.findOne(event.eventId, job.id)).toMatchObject({ status: 'FAILED', result: null });
    expect(await prisma.seat.count()).toBe(0);
  });

  it('recovers an expired claim once and rejects its former owner', async () => {
    const event = await setup();
    const job = await start(event);
    const former = await queue.claim();
    await prisma.seatingJob.update({ where: { id: job.id }, data: { leaseUntil: new Date(0) } });
    await runner.runOne();
    await runner.process(former!);
    expect(await jobs.findOne(event.eventId, job.id)).toMatchObject({ status: 'COMPLETED', attempts: 2, result: { seated: 1 } });
    expect(await prisma.seat.count()).toBe(1);
  });
  it('invalidates a plan when attendance mode changes and requires fresh confirmation', async () => {
    const event = await setup();
    const job = await start(event);
    const original = planner.plan.bind(planner);
    const policies = new AttendancePolicyService(prisma as unknown as PrismaService, { invalidateInvitation: jest.fn().mockResolvedValue(undefined) } as unknown as CacheService);
    jest.spyOn(planner, 'plan').mockImplementationOnce(async (input) => {
      const plan = await original(input);
      const preview = await policies.preview(event.eventId, 'PER_VENUE');
      await policies.change(event.eventId, { ...preview.request, transitionId: randomUUID() });
      return plan;
    });
    await runner.runOne();
    expect(await jobs.findOne(event.eventId, job.id)).toMatchObject({ status: 'QUEUED', failureReason: 'STATE_CHANGED' });
    expect(await prisma.seat.count()).toBe(0);
    await prisma.seatingJob.update({ where: { id: job.id }, data: { nextAttemptAt: new Date(0) } });
    await runner.runOne();
    expect(await jobs.findOne(event.eventId, job.id)).toMatchObject({ status: 'COMPLETED', attendanceRevision: 2, result: { seated: 0 } });
  });

  it('rolls back seat writes if the lease owner changes during computation', async () => {
    const event = await setup();
    const job = await start(event);
    const original = planner.plan.bind(planner);
    jest.spyOn(planner, 'plan').mockImplementationOnce(async (input) => {
      const plan = await original(input);
      await prisma.seatingJob.update({ where: { id: job.id }, data: { leaseOwner: randomUUID() } });
      return plan;
    });
    await runner.runOne();
    expect(await prisma.seat.count()).toBe(0);
    expect(await jobs.findOne(event.eventId, job.id)).toMatchObject({ status: 'RUNNING', result: null });
    await prisma.seatingJob.update({ where: { id: job.id }, data: { leaseUntil: new Date(0) } });
    await runner.runOne();
    expect(await jobs.findOne(event.eventId, job.id)).toMatchObject({ status: 'COMPLETED', attempts: 2, result: { seated: 1 } });
  });

  it('fails exhausted claims and allows a new explicit regeneration', async () => {
    const event = await setup();
    const job = await start(event);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(await queue.claim()).toMatchObject({ id: job.id, attempts: attempt + 1 });
      await prisma.seatingJob.update({ where: { id: job.id }, data: { leaseUntil: new Date(0) } });
    }
    expect(await queue.claim()).toBeNull();
    expect(await jobs.findOne(event.eventId, job.id)).toMatchObject({ status: 'FAILED', failureReason: 'LEASE_EXHAUSTED' });
    expect(await start(event)).toMatchObject({ status: 'QUEUED' });
  });

  it('rejects an oversized room before attempting to plan it', async () => {
    const event = await setup();
    await prisma.table.createMany({ data: Array.from({ length: 500 }, (_, index) => ({ eventId: event.eventId, name: `Extra ${index}`, capacity: 2 })) });
    const job = await start(event);
    const computation = jest.spyOn(planner, 'plan');
    await runner.runOne();
    expect(computation).not.toHaveBeenCalled();
    expect(await jobs.findOne(event.eventId, job.id)).toMatchObject({ status: 'FAILED', failureReason: 'INPUT_LIMIT_EXCEEDED' });
    expect(await prisma.seat.count()).toBe(0);
  });

  it('recovers a terminated real worker and stops its replacement gracefully', async () => {
    const event = await setup();
    const job = await start(event);
    const root = await mkdtemp(join(tmpdir(), 'aveline-seating-worker-'));
    let release = () => undefined as void;
    let locked = () => undefined as void;
    const isLocked = new Promise<void>((resolve) => { locked = resolve; });
    const canRelease = new Promise<void>((resolve) => { release = resolve; });
    const fence = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${event.userId} FOR UPDATE`;
      locked();
      await canRelease;
    }, { timeout: 25_000 });
    await isLocked;
    const first = startSeatingWorker(join(root, 'first'));
    let replacement: ReturnType<typeof startSeatingWorker> | undefined;
    try {
      await waitForSeatingState(prisma, job.id, 'RUNNING');
      first.child.kill('SIGKILL');
      await first.exited;
      await prisma.seatingJob.update({ where: { id: job.id }, data: { leaseUntil: new Date(0) } });
      replacement = startSeatingWorker(join(root, 'replacement'));
      await waitForSeatingState(prisma, job.id, 'RUNNING', 2);
      // SIGTERM must finish this blocked active claim, not abandon it.
      replacement.child.kill('SIGTERM');
      release();
      await fence;
      expect(await replacement.exited).toBe(0);
      expect(await jobs.findOne(event.eventId, job.id)).toMatchObject({ status: 'COMPLETED', attempts: 2, result: { seated: 1 } });
      expect(await prisma.seat.count()).toBe(1);
    } finally {
      release();
      await fence;
      first.child.kill('SIGKILL');
      replacement?.child.kill('SIGKILL');
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(['EVENT_WIDE', 'PER_VENUE'] as const)('seats the 400-person rehearsal independently in two venues using %s attendance', async (mode) => {
    const event = await seedSeatingRehearsal(prisma, mode);
    const first = await runAutomaticSeating(prisma, event.eventId, event.firstArrangement.id);
    const second = await runAutomaticSeating(prisma, event.eventId, event.secondArrangement.id);
    expect(first).toMatchObject({ seated: 400, households: 100, unseated: [] });
    expect(second).toMatchObject({ seated: mode === 'PER_VENUE' ? 200 : 400, unseated: [] });
    const split = await prisma.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM
      (SELECT s."arrangementId", g."householdId" FROM seats s JOIN guests g ON g.id = s."guestId" WHERE s."eventId" = ${event.eventId}
        GROUP BY s."arrangementId", g."householdId" HAVING count(DISTINCT s."tableId") > 1) invalid`;
    const overfull = await prisma.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM
      (SELECT t.id FROM tables t JOIN seats s ON s."tableId" = t.id WHERE t."eventId" = ${event.eventId}
        GROUP BY t.id HAVING count(*) > t.capacity) invalid`;
    expect(split[0].count).toBe(0n);
    expect(overfull[0].count).toBe(0n);
  });

  it('invalidates a captured plan when ticket cancellation changes eligibility through raw SQL', async () => {
    const event = await setup();
    const type = await prisma.ticketType.create({ data: { eventId: event.eventId, priceMinor: 0n, quantityTotal: 1 } });
    const order = await prisma.ticketOrder.create({ data: { eventId: event.eventId, buyerName: 'Buyer', buyerEmail: 'buyer@test.local', totalMinor: 0n,
      status: 'PAID', accessToken: randomUUID(), idempotencyKey: randomUUID() } });
    await prisma.ticket.create({ data: { eventId: event.eventId, orderId: order.id, ticketTypeId: type.id, guestId: event.guest.id, code: randomUUID() } });
    const job = await start(event);
    const original = planner.plan.bind(planner);
    jest.spyOn(planner, 'plan').mockImplementationOnce(async (input) => {
      const plan = await original(input);
      await prisma.$transaction((tx) => withdrawTicketGuests(tx, event.eventId, order.id));
      return plan;
    });
    await runner.runOne();
    expect(await jobs.findOne(event.eventId, job.id)).toMatchObject({ status: 'QUEUED', failureReason: 'STATE_CHANGED' });
    expect(await prisma.seat.count()).toBe(0);
    expect((await prisma.rsvp.findUniqueOrThrow({ where: { guestId: event.guest.id } })).status).toBe('DECLINED');
  });

  it('discards inputs captured before subject erasure and never stores the old identity in its result', async () => {
    const event = await setup();
    await prisma.guest.update({ where: { id: event.guest.id }, data: { email: 'seating-subject@test.local' } });
    const job = await start(event);
    const original = planner.plan.bind(planner);
    jest.spyOn(planner, 'plan').mockImplementationOnce(async (input) => {
      const plan = await original(input);
      await prisma.$transaction((tx) => eraseSubject(tx, 'seating-subject@test.local', new Date()));
      return plan;
    });
    await runner.runOne();
    expect(await jobs.findOne(event.eventId, job.id)).toMatchObject({ status: 'QUEUED', failureReason: 'STATE_CHANGED', result: null });
    expect(await prisma.seat.count()).toBe(0);
    expect((await prisma.guest.findUniqueOrThrow({ where: { id: event.guest.id } })).anonymizedAt).not.toBeNull();
  });

  it('detects an edit followed by an undo even when the final room looks identical', async () => {
    const event = await setup();
    const job = await start(event);
    const original = planner.plan.bind(planner);
    jest.spyOn(planner, 'plan').mockImplementationOnce(async (input) => {
      const plan = await original(input);
      await prisma.table.update({ where: { id: event.table.id }, data: { capacity: 4 } });
      await prisma.table.update({ where: { id: event.table.id }, data: { capacity: 3 } });
      return plan;
    });
    await runner.runOne();
    expect(await jobs.findOne(event.eventId, job.id)).toMatchObject({ status: 'QUEUED', failureReason: 'STATE_CHANGED' });
    expect(await prisma.seat.count()).toBe(0);
  });

  it('cannot leave work or seats behind when its event is deleted during computation', async () => {
    const event = await setup();
    await start(event);
    const original = planner.plan.bind(planner);
    jest.spyOn(planner, 'plan').mockImplementationOnce(async (input) => {
      const plan = await original(input);
      await prisma.event.delete({ where: { id: event.eventId } });
      return plan;
    });
    await runner.runOne();
    expect(await prisma.seatingJob.count()).toBe(0);
    expect(await prisma.seat.count()).toBe(0);
    expect(await runner.runOne()).toBe(false);
  });

});
