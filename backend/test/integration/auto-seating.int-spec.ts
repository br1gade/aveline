import { PrismaClient } from '@prisma/client';
import { SeatingService } from '../../src/modules/seating/seating.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { seedEvent } from '../fixtures/event.fixture';
import { runAutomaticSeating, seatingTestJob } from '../fixtures/seating-job.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

describe('Automatic seating alongside manual work (integration)', () => {
  let prisma: PrismaClient;
  beforeAll(() => { prisma = testPrisma(); });
  beforeEach(() => resetTestDatabase());
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => disconnectTestDatabase());
  it('replans after a coordinator fills a chair during computation, preserving that manual seat', async () => {
    const { eventId } = await seedEvent(prisma);
    const table = await prisma.table.create({ data: { eventId, name: 'Table 1', capacity: 2 } });
    for (const name of ['Ani', 'Aram', 'Narek']) {
      const household = await prisma.household.create({ data: { eventId, name, seatsAllotted: 1 } });
      await prisma.guest.create({ data: { eventId, householdId: household.id, firstName: name, token: `${name}-${eventId}`,
        rsvp: { create: { status: name === 'Narek' ? 'PENDING' : 'ATTENDING' } } } });
    }
    const narek = await prisma.guest.findUniqueOrThrow({ where: { token: `Narek-${eventId}` } });
    const worker = await seatingTestJob(prisma, eventId);
    const original = worker.planner.plan.bind(worker.planner);
    jest.spyOn(worker.planner, 'plan').mockImplementationOnce(async (input) => {
      const plan = await original(input);
      await new SeatingService(prisma as unknown as PrismaService).assign(eventId, { guestId: narek.id, tableId: table.id });
      return plan;
    });
    await worker.runner.runOne();
    expect(await worker.jobs.findOne(eventId, worker.job.id)).toMatchObject({ status: 'QUEUED', failureReason: 'STATE_CHANGED' });
    expect(await prisma.seat.count({ where: { tableId: table.id } })).toBe(1);
    expect(await runAutomaticSeating(prisma, eventId)).toMatchObject({ seated: 1 });
    expect(await prisma.seat.count({ where: { tableId: table.id } })).toBe(2);
    expect(await prisma.seat.count({ where: { guestId: narek.id, tableId: table.id } })).toBe(1);
  });
});
