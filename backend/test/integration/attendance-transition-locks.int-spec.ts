import { ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { CacheService } from '../../src/infra/cache/cache.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AttendancePolicyService } from '../../src/modules/events/attendance-policy.service';
import { lockAttendancePolicy } from '../../src/modules/rsvp/attendance/attendance-context';
import { recordAnswer } from '../../src/modules/rsvp/answer-writes';
import { HostRsvpService } from '../../src/modules/rsvp/host-rsvp.service';
import { RsvpConfirmerService } from '../../src/modules/invitations/sending/rsvp-confirmer.service';
import { VenuesService } from '../../src/modules/design/venues.service';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

describe('Attendance transition serialization (integration)', () => {
  let prisma: PrismaClient;
  beforeAll(() => { prisma = testPrisma(); });
  beforeEach(() => resetTestDatabase());
  afterAll(() => disconnectTestDatabase());
  const cache = { invalidateInvitation: jest.fn().mockResolvedValue(undefined) } as unknown as CacheService;

  it('waits for an already-started answer and then rejects the stale preview without losing the answer', async () => {
    const event = await seedEvent(prisma);
    const guest = await prisma.guest.findUniqueOrThrow({ where: { token: event.primaryGuestToken } });
    const policy = new AttendancePolicyService(prisma as unknown as PrismaService, cache);
    const preview = await policy.preview(event.eventId, 'PER_VENUE');
    let signalLocked!: () => void;
    let releaseAnswer!: () => void;
    const isLocked = new Promise<void>((resolve) => { signalLocked = resolve; });
    const canFinish = new Promise<void>((resolve) => { releaseAnswer = resolve; });
    const answering = prisma.$transaction(async (tx) => {
      const context = await lockAttendancePolicy(tx, event.eventId);
      signalLocked();
      await canFinish;
      return recordAnswer(tx, guest.id, { status: 'ATTENDING' }, { policy: context });
    });
    const answerResult = Promise.allSettled([answering]);
    await isLocked;
    const transitionResult = Promise.allSettled([policy.change(event.eventId, { ...preview.request, transitionId: randomUUID() })]);
    releaseAnswer();
    expect((await answerResult)[0].status).toBe('fulfilled');
    expect((await transitionResult)[0]).toMatchObject({ status: 'rejected', reason: expect.any(ConflictException) });
    expect((await prisma.rsvp.findUniqueOrThrow({ where: { guestId: guest.id } })).status).toBe('ATTENDING');
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.eventId } })).attendanceRevision).toBe(1);
  });

  it('rejects an old host form after a transition holding the event lock commits', async () => {
    const event = await seedEvent(prisma);
    const guest = await prisma.guest.findUniqueOrThrow({ where: { token: event.primaryGuestToken } });
    let signalLocked!: () => void;
    let releasePolicy!: () => void;
    const isLocked = new Promise<void>((resolve) => { signalLocked = resolve; });
    const canFinish = new Promise<void>((resolve) => { releasePolicy = resolve; });
    const transition = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM events WHERE id = ${event.eventId} FOR UPDATE`;
      await tx.attendancePolicy.updateMany({ where: { eventId: event.eventId }, data: { isActive: false } });
      await tx.attendancePolicy.create({ data: { eventId: event.eventId, revision: 2, mode: 'PER_VENUE' } });
      await tx.event.update({ where: { id: event.eventId }, data: { attendanceMode: 'PER_VENUE', attendanceRevision: 2 } });
      signalLocked();
      await canFinish;
    });
    const transitionResult = Promise.allSettled([transition]);
    await isLocked;
    const host = new HostRsvpService(prisma as unknown as PrismaService, { confirm: jest.fn() } as unknown as RsvpConfirmerService);
    const answerResult = Promise.allSettled([host.record(event.eventId, guest.id, { status: 'ATTENDING', attendanceRevision: 1 })]);
    releasePolicy();
    expect((await transitionResult)[0].status).toBe('fulfilled');
    expect((await answerResult)[0]).toMatchObject({ status: 'rejected', reason: expect.any(ConflictException) });
    expect(await prisma.attendanceResponse.count()).toBe(0);
  });

  it('waits for RSVP release history before a venue edit takes arrangement locks', async () => {
    const event = await seedEvent(prisma);
    const guest = await prisma.guest.findUniqueOrThrow({ where: { token: event.primaryGuestToken } });
    const venue = await prisma.venue.findFirstOrThrow({ where: { eventId: event.eventId } });
    const table = await prisma.table.create({ data: { eventId: event.eventId, venueId: venue.id, name: 'Table', capacity: 2 } });
    await prisma.seat.create({ data: { guestId: guest.id, tableId: table.id } });
    let signalLocked!: () => void;
    let releaseAnswer!: () => void;
    const isLocked = new Promise<void>((resolve) => { signalLocked = resolve; });
    const canFinish = new Promise<void>((resolve) => { releaseAnswer = resolve; });
    const answering = prisma.$transaction(async (tx) => {
      const context = await lockAttendancePolicy(tx, event.eventId);
      await tx.rsvp.update({ where: { guestId: guest.id }, data: { dietaryNotes: 'Changing' } });
      signalLocked();
      await canFinish;
      return recordAnswer(tx, guest.id, { status: 'DECLINED' }, { policy: context });
    });
    const answerResult = Promise.allSettled([answering]);
    await isLocked;
    const venues = new VenuesService(prisma as unknown as PrismaService, cache);
    const editResult = Promise.allSettled([venues.update(event.eventId, venue.id, { capacity: 10 })]);
    releaseAnswer();
    expect((await answerResult)[0].status).toBe('fulfilled');
    expect((await editResult)[0].status).toBe('fulfilled');
    expect(await prisma.seatRelease.count()).toBe(1);
    expect(await prisma.seat.count()).toBe(0);
  });
});
