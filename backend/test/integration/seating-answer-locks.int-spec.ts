import { runAutomaticSeating, seatingTestJob } from '../fixtures/seating-job.fixture';
import { PrismaClient } from '@prisma/client';
import { recordAnswer } from '../../src/modules/rsvp/answer-writes';
import { SeatingService } from '../../src/modules/seating/seating.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

describe('Seating and answer lock ordering (integration)', () => {
  let prisma: PrismaClient;
  beforeAll(() => { prisma = testPrisma(); });
  beforeEach(() => resetTestDatabase());
  afterAll(() => disconnectTestDatabase());

  it('serializes a host answer holding the guest row with manual seating, without a deadlock', async () => {
    const { eventId, primaryGuestToken } = await seedEvent(prisma);
    const guest = await prisma.guest.findUniqueOrThrow({ where: { token: primaryGuestToken } });
    const table = await prisma.table.create({ data: { eventId, name: 'Table', capacity: 2 } });
    let signalLocked!: () => void;
    const isLocked = new Promise<void>((resolve) => { signalLocked = resolve; });
    const host = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM guests WHERE id = ${guest.id} FOR UPDATE`;
      signalLocked();
      await new Promise((resolve) => setTimeout(resolve, 250));
      return recordAnswer(tx, guest.id, { status: 'ATTENDING' });
    });
    await isLocked;
    const seating = new SeatingService(prisma as unknown as PrismaService);
    const outcomes = await Promise.allSettled([host, seating.assign(eventId, { guestId: guest.id, tableId: table.id })]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(await prisma.seat.count({ where: { guestId: guest.id } })).toBe(1);
  });

  it('reports a household being edited by the host instead of deadlocking automatic seating', async () => {
    const { eventId, primaryGuestToken } = await seedEvent(prisma);
    const guest = await prisma.guest.findUniqueOrThrow({ where: { token: primaryGuestToken } });
    await prisma.rsvp.update({ where: { guestId: guest.id }, data: { status: 'ATTENDING' } });
    const table = await prisma.table.create({ data: { eventId, name: 'Table', capacity: 2 } });
    const worker = await seatingTestJob(prisma, eventId);
    let signalLocked!: () => void;
    let releaseHost!: () => void;
    const isLocked = new Promise<void>((resolve) => { signalLocked = resolve; });
    const canFinish = new Promise<void>((resolve) => { releaseHost = resolve; });
    const host = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM guests WHERE id = ${guest.id} FOR UPDATE`;
      signalLocked();
      await canFinish;
      return recordAnswer(tx, guest.id, { status: 'ATTENDING' });
    });
    const settled = Promise.allSettled([host]);
    await isLocked;
    try {
      await worker.runner.runOne();
      expect(await worker.jobs.findOne(eventId, worker.job.id)).toMatchObject({ status: 'QUEUED', failureReason: 'STATE_CHANGED', result: null });
    } finally {
      releaseHost();
      await settled;
    }
    expect(await runAutomaticSeating(prisma, eventId)).toMatchObject({ seated: 1 });
    expect(await prisma.seat.count({ where: { tableId: table.id } })).toBe(1);
  });

  it('defers the whole household when one attendance answer is changing, then seats them together', async () => {
    const { eventId, primaryGuestToken, householdId } = await seedEvent(prisma);
    const guest = await prisma.guest.findUniqueOrThrow({ where: { token: primaryGuestToken } });
    await prisma.rsvp.update({ where: { guestId: guest.id }, data: { status: 'ATTENDING' } });
    const member = await prisma.guest.create({
      data: { eventId, householdId, firstName: 'Member', token: `member-${eventId}`, rsvp: { create: { status: 'ATTENDING' } } },
    });
    await prisma.table.create({ data: { eventId, name: 'Table', capacity: 2 } });
    const worker = await seatingTestJob(prisma, eventId);
    let signalLocked!: () => void;
    let releaseAnswer!: () => void;
    const isLocked = new Promise<void>((resolve) => { signalLocked = resolve; });
    const canFinish = new Promise<void>((resolve) => { releaseAnswer = resolve; });
    const answer = prisma.$transaction(async (tx) => {
      await tx.rsvp.update({ where: { guestId: member.id }, data: { dietaryNotes: 'An update' } });
      signalLocked();
      await canFinish;
    });
    const settled = Promise.allSettled([answer]);
    await isLocked;
    try {
      await worker.runner.runOne();
      expect(await worker.jobs.findOne(eventId, worker.job.id)).toMatchObject({ status: 'QUEUED', failureReason: 'STATE_CHANGED', result: null });
      expect(await prisma.seat.count({ where: { guest: { householdId } } })).toBe(0);
    } finally {
      releaseAnswer();
      await settled;
    }
    expect(await runAutomaticSeating(prisma, eventId)).toMatchObject({ seated: 2 });
    const seats = await prisma.seat.findMany({ where: { guest: { householdId } } });
    expect(new Set(seats.map((seat) => seat.tableId)).size).toBe(1);
  });


  it('prevents a concurrent table move from carrying new release history into another venue', async () => {
    const { eventId, primaryGuestToken } = await seedEvent(prisma);
    const guest = await prisma.guest.findUniqueOrThrow({ where: { token: primaryGuestToken } });
    const reception = await prisma.venue.findFirstOrThrow({ where: { eventId } });
    const ceremony = await prisma.venue.create({ data: { eventId, role: 'CEREMONY', name: 'Church', address: 'Other' } });
    const table = await prisma.table.create({ data: { eventId, venueId: reception.id, name: 'Empty', capacity: 2 } });
    let signalCreated!: () => void;
    let releaseHistory!: () => void;
    const isCreated = new Promise<void>((resolve) => { signalCreated = resolve; });
    const canFinish = new Promise<void>((resolve) => { releaseHistory = resolve; });
    const history = prisma.$transaction(async (tx) => {
      await tx.seatRelease.create({ data: { guestId: guest.id, eventId, arrangementId: table.arrangementId, tableId: table.id, releasedAt: new Date() } });
      signalCreated();
      await canFinish;
    });
    const settled = Promise.allSettled([history]);
    await isCreated;
    const moving = prisma.table.update({ where: { id: table.id }, data: { venueId: ceremony.id } });
    const moveResult = Promise.allSettled([moving]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    releaseHistory();
    expect((await settled)[0].status).toBe('fulfilled');
    expect((await moveResult)[0].status).toBe('rejected');
    expect((await prisma.table.findUniqueOrThrow({ where: { id: table.id } })).venueId).toBe(reception.id);
  });

});
