import { randomUUID } from 'node:crypto';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma, TEST_DATABASE_URL } from '../setup/test-database';
import { PrismaClient } from '@prisma/client';
import { recordAnswer } from '../../src/modules/rsvp/answer-writes';
import { lockAttendancePolicy } from '../../src/modules/rsvp/attendance/attendance-context';
import { readGuestPageMeta } from '../../src/modules/invitations/guest-page-version';
import { venueConfirmationDedupe, VENUE_CONFIRMATION_TEMPLATE_KEY } from '../../src/modules/invitations/sending/venue-confirmation';

describe('Seating invalidation concurrency', () => {
  const prisma = testPrisma();
  beforeEach(() => resetTestDatabase());
  afterAll(() => disconnectTestDatabase());

  it('deduplicates the same venue response and permits a changed response from one confirmation snapshot', async () => {
    const event = await seedEvent(prisma);
    const guest = await prisma.guest.findUniqueOrThrow({ where: { token: event.primaryGuestToken } });
    const now = new Date();
    const first = await venueConfirmationDedupe(prisma, event.householdId, now);
    expect(first).toMatch(/:0$/);
    const organization = await prisma.event.findUniqueOrThrow({ where: { id: event.eventId }, select: { organizationId: true } });
    await prisma.message.create({ data: { organizationId: organization.organizationId, eventId: event.eventId, guestId: guest.id,
      channel: 'EMAIL', templateKey: VENUE_CONFIRMATION_TEMPLATE_KEY, toAddress: 'fixture@example.test', subject: 'Confirmation', body: 'Synthetic confirmation', dedupeKey: first! } });
    expect(await venueConfirmationDedupe(prisma, event.householdId, now)).toBeNull();
    await prisma.attendanceResponse.create({ data: { eventId: event.eventId, guestId: guest.id, revision: 1, scopeId: 'event', status: 'ATTENDING', respondedAt: now } });
    expect(await venueConfirmationDedupe(prisma, event.householdId, now)).toMatch(/:1$/);
  });

  it('records one venue reply and withdraws reminders in at most six write-path statements', async () => {
    const event = await seedEvent(prisma);
    const guest = await prisma.guest.findUniqueOrThrow({ where: { token: event.primaryGuestToken } });
    const venue = await prisma.venue.findFirstOrThrow({ where: { eventId: event.eventId } });
    await prisma.$transaction(async (tx) => {
      await tx.attendancePolicy.updateMany({ where: { eventId: event.eventId }, data: { isActive: false } });
      await tx.attendancePolicy.create({ data: { eventId: event.eventId, revision: 2, mode: 'PER_VENUE' } });
      await tx.event.update({ where: { id: event.eventId }, data: { attendanceMode: 'PER_VENUE', attendanceRevision: 2 } });
    });
    const reader = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } }, log: [{ emit: 'event', level: 'query' }] });
    let statements = 0; reader.$on('query', () => { statements += 1; });
    try {
      await reader.$transaction(async (tx) => {
        const policy = await lockAttendancePolicy(tx, event.eventId); statements = 0;
        const answer = await recordAnswer(tx, guest.id, { status: 'ATTENDING' }, { policy, venueAttendance: [{ venueId: venue.id, status: 'ATTENDING' }] });
        expect(answer.status).toBe('ATTENDING'); expect(statements).toBeLessThanOrEqual(6);
      });
    } finally { await reader.$disconnect(); }
  });

  it.each(['EVENT_WIDE', 'PER_VENUE'] as const)('does not invalidate every guest page when an identical %s answer is submitted again', async (mode) => {
    const event = await seedEvent(prisma);
    const guest = await prisma.guest.findUniqueOrThrow({ where: { token: event.primaryGuestToken } });
    const venue = await prisma.venue.findFirstOrThrow({ where: { eventId: event.eventId } });
    if (mode === 'PER_VENUE') await prisma.$transaction(async (tx) => {
      await tx.attendancePolicy.updateMany({ where: { eventId: event.eventId }, data: { isActive: false } });
      await tx.attendancePolicy.create({ data: { eventId: event.eventId, revision: 2, mode } });
      await tx.event.update({ where: { id: event.eventId }, data: { attendanceMode: mode, attendanceRevision: 2 } });
      await tx.attendanceResponse.create({ data: { eventId: event.eventId, guestId: guest.id, revision: 2, scopeId: venue.id, venueId: venue.id, status: 'ATTENDING', respondedAt: null } });
    });
    const answer = () => prisma.$transaction(async (tx) => {
      const policy = await lockAttendancePolicy(tx, event.eventId);
      return recordAnswer(tx, guest.id, { status: 'ATTENDING', dietary: ['Vegetarian'] }, { policy,
        ...(mode === 'PER_VENUE' ? { venueAttendance: [{ venueId: venue.id, status: 'ATTENDING' as const }] } : {}) });
    });
    const first = await answer();
    const [before] = await readGuestPageMeta(prisma, event.slug, guest.token);
    const repeated = await answer();
    const [after] = await readGuestPageMeta(prisma, event.slug, guest.token);
    expect(repeated).toEqual(first);
    expect(after.revision).toBe(before.revision);
  });

  it('lets an independent RSVP finish while another household transaction is open', async () => {
    const event = await seedEvent(prisma);
    const first = await prisma.guest.findUniqueOrThrow({ where: { token: event.primaryGuestToken } });
    const household = await prisma.household.create({ data: { eventId: event.eventId, name: 'Independent', seatsAllotted: 1 } });
    const second = await prisma.guest.create({ data: { eventId: event.eventId, householdId: household.id, firstName: 'Other household', token: randomUUID(), rsvp: { create: {} } } });
    const before = await prisma.seatingArrangement.findFirstOrThrow({ where: { eventId: event.eventId } });
    let unlock!: () => void;
    let ready!: () => void;
    const held = new Promise<void>((resolve) => { unlock = resolve; });
    const started = new Promise<void>((resolve) => { ready = resolve; });
    const writer = prisma.$transaction(async (tx) => {
      await tx.rsvp.update({ where: { guestId: first.id }, data: { status: 'ATTENDING' } });
      ready();
      await held;
    });
    await started;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL statement_timeout = '1500ms'`;
        await tx.rsvp.update({ where: { guestId: second.id }, data: { status: 'DECLINED' } });
      });
    } finally { unlock(); await writer; }
    const after = await prisma.seatingArrangement.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.revision).toBeGreaterThanOrEqual(before.revision + 2);
  });
});
