import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { CacheService } from '../../src/infra/cache/cache.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AttendancePolicyService } from '../../src/modules/events/attendance-policy.service';
import { RsvpService } from '../../src/modules/rsvp/rsvp.service';
import { HostRsvpService } from '../../src/modules/rsvp/host-rsvp.service';
import { RsvpConfirmerService } from '../../src/modules/invitations/sending/rsvp-confirmer.service';
import { SeatingService } from '../../src/modules/seating/seating.service';
import { VenuesService } from '../../src/modules/design/venues.service';
import { TimelineService } from '../../src/modules/design/timeline.service';
import { OperationsService } from '../../src/modules/operations/operations.service';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

describe('Attendance policies and venue responses (integration)', () => {
  let prisma: PrismaClient;
  let policy: AttendancePolicyService;
  let rsvp: RsvpService;
  let host: HostRsvpService;
  let seating: SeatingService;
  let venuesService: VenuesService;
  let timeline: TimelineService;
  const cache = { invalidateInvitation: jest.fn().mockResolvedValue(undefined) } as unknown as CacheService;
  beforeAll(() => {
    prisma = testPrisma();
    const database = prisma as unknown as PrismaService;
    const confirmer = { confirm: jest.fn().mockResolvedValue(undefined) } as unknown as RsvpConfirmerService;
    policy = new AttendancePolicyService(database, cache);
    rsvp = new RsvpService(database, confirmer);
    host = new HostRsvpService(database, confirmer);
    seating = new SeatingService(database);
    venuesService = new VenuesService(database, cache);
    timeline = new TimelineService(database, cache);
  });
  beforeEach(() => resetTestDatabase());
  afterAll(() => disconnectTestDatabase());

  const fixture = async () => {
    const event = await seedEvent(prisma, { seatsAllotted: 4 });
    const guest = await prisma.guest.findUniqueOrThrow({ where: { token: event.primaryGuestToken } });
    const hall = await prisma.venue.findFirstOrThrow({ where: { eventId: event.eventId } });
    const church = await venuesService.create(event.eventId, { role: 'CEREMONY', name: 'Church', address: '2 Test St' });
    const tables = await Promise.all([hall, church].map((venue) => prisma.table.create({ data: { eventId: event.eventId, venueId: venue.id, name: 'Table', capacity: 4 } })));
    return { ...event, guest, hall, church, tables };
  };

  const change = async (eventId: string, mode: 'EVENT_WIDE' | 'PER_VENUE') => {
    const preview = await policy.preview(eventId, mode);
    return policy.change(eventId, { ...preview.request, transitionId: randomUUID() });
  };

  it('preserves answers, seats, dietary choices and admission when switching in either direction', async () => {
    const event = await fixture();
    await rsvp.submit(event.slug, event.primaryGuestToken, { status: 'ATTENDING', dietary: ['vegetarian'], message: 'Keep me' });
    await prisma.seat.createMany({ data: event.tables.map((table) => ({ guestId: event.guest.id, tableId: table.id })) });
    await prisma.checkIn.create({ data: { guestId: event.guest.id } });
    await change(event.eventId, 'PER_VENUE');
    expect(await prisma.rsvp.findUniqueOrThrow({ where: { guestId: event.guest.id } })).toMatchObject({ status: 'PENDING', respondedAt: null, dietary: ['vegetarian'], message: 'Keep me' });
    expect(await prisma.seat.count()).toBe(2);
    expect(await prisma.checkIn.count()).toBe(1);
    expect((await seating.listTables(event.eventId)).flatMap((table) => table.guests).every((guest) => guest.isReservation)).toBe(true);
    await rsvp.submit(event.slug, event.primaryGuestToken, { attendanceRevision: 2, venueAttendance: [{ venueId: event.hall.id, status: 'ATTENDING' }, { venueId: event.church.id, status: 'UNDECIDED' }] });
    await change(event.eventId, 'EVENT_WIDE');
    expect(await prisma.rsvp.findUniqueOrThrow({ where: { guestId: event.guest.id } })).toMatchObject({ status: 'PENDING', dietary: ['vegetarian'] });
    await expect(rsvp.submit(event.slug, event.primaryGuestToken, { status: 'ATTENDING' })).rejects.toBeInstanceOf(ConflictException);
    await rsvp.submit(event.slug, event.primaryGuestToken, { attendanceRevision: 3, status: 'DECLINED' });
    expect(await prisma.seat.count()).toBe(0);
    expect(await prisma.seatRelease.count()).toBe(2);
    const history = await policy.history(event.eventId, event.guest.id);
    expect(history.map((answer) => [answer.revision, answer.status]).sort()).toEqual([[1, 'ATTENDING'], [2, 'ATTENDING'], [2, 'UNDECIDED'], [3, 'DECLINED']]);
    expect(await prisma.checkIn.count()).toBe(1);
  });

  it('releases a declined venue only and treats unanswered venues as pending', async () => {
    const event = await fixture();
    await prisma.seat.createMany({ data: event.tables.map((table) => ({ guestId: event.guest.id, tableId: table.id })) });
    await change(event.eventId, 'PER_VENUE');
    const first = await rsvp.submit(event.slug, event.primaryGuestToken, { attendanceRevision: 2, venueAttendance: [{ venueId: event.hall.id, status: 'DECLINED' }] });
    expect(first.status).toBe('PENDING');
    expect(await prisma.seat.findMany()).toEqual([expect.objectContaining({ tableId: event.tables[1].id })]);
    const second = await rsvp.submit(event.slug, event.primaryGuestToken, { attendanceRevision: 2, venueAttendance: [{ venueId: event.church.id, status: 'ATTENDING' }] });
    expect(second.status).toBe('ATTENDING');
    const view = await rsvp.getForGuest(event.slug, event.primaryGuestToken);
    expect(view.attendance).toMatchObject({ needsReconfirmation: false, revision: 2 });
    expect(view.attendance.venues.map((venue) => venue.status)).toEqual(['DECLINED', 'ATTENDING']);
  });

  it('uses each new person and household member own venue answers without inferred followers', async () => {
    const event = await fixture();
    await change(event.eventId, 'PER_VENUE');
    const accepted = [{ venueId: event.hall.id, status: 'ATTENDING' as const }];
    await rsvp.submit(event.slug, event.primaryGuestToken, { attendanceRevision: 2, venueAttendance: accepted, party: [{ firstName: 'Member', venueAttendance: accepted }] });
    const member = await prisma.guest.findFirstOrThrow({ where: { householdId: event.householdId, addedByGuest: true } });
    await rsvp.submit(event.slug, event.primaryGuestToken, { attendanceRevision: 2, venueAttendance: [{ venueId: event.hall.id, status: 'DECLINED' }] });
    expect((await prisma.rsvp.findUniqueOrThrow({ where: { guestId: member.id } })).status).toBe('ATTENDING');
    await rsvp.submit(event.slug, event.primaryGuestToken, { attendanceRevision: 2, venueAttendance: [{ venueId: event.hall.id, status: 'DECLINED' }], members: [{ guestId: member.id, venueAttendance: [{ venueId: event.hall.id, status: 'DECLINED' }] }] });
    expect((await prisma.rsvp.findUniqueOrThrow({ where: { guestId: member.id } })).status).toBe('PENDING');
    await expect(rsvp.submit(event.slug, event.primaryGuestToken, { attendanceRevision: 2, venueAttendance: accepted, party: [{ firstName: 'Missing' }] })).rejects.toBeInstanceOf(BadRequestException);
    expect(await prisma.guest.count()).toBe(2);
  });

  it('merges simultaneous host responses at different venues instead of losing a venue', async () => {
    const event = await fixture();
    await change(event.eventId, 'PER_VENUE');
    await Promise.all([event.hall, event.church].map((venue) => host.record(event.eventId, event.guest.id, { attendanceRevision: 2, venueAttendance: [{ venueId: venue.id, status: 'ATTENDING' }] })));
    expect(await prisma.attendanceResponse.count({ where: { guestId: event.guest.id, revision: 2 } })).toBe(2);
    expect((await rsvp.getForGuest(event.slug, event.primaryGuestToken)).attendance.needsReconfirmation).toBe(false);
  });

  it('makes retries idempotent and rejects competing or changed transition payloads', async () => {
    const event = await fixture();
    const preview = await policy.preview(event.eventId, 'PER_VENUE');
    const request = { ...preview.request, transitionId: randomUUID() };
    expect(await Promise.all([policy.change(event.eventId, request), policy.change(event.eventId, request)])).toEqual([expect.objectContaining({ revision: 2 }), expect.objectContaining({ revision: 2 })]);
    expect(await prisma.attendancePolicy.count({ where: { eventId: event.eventId } })).toBe(2);
    await expect(policy.change(event.eventId, { ...request, transitionId: randomUUID() })).rejects.toBeInstanceOf(ConflictException);
    await expect(policy.change(event.eventId, { ...request, mode: 'EVENT_WIDE' })).rejects.toBeInstanceOf(ConflictException);
  });

  it.each(['answer', 'seat'])('requires a new preview after a %s changes even when no policy changed', async (kind) => {
    const event = await fixture();
    const preview = await policy.preview(event.eventId, 'PER_VENUE');
    if (kind === 'answer') await host.record(event.eventId, event.guest.id, { status: 'ATTENDING' });
    else await seating.assign(event.eventId, { guestId: event.guest.id, tableId: event.tables[0].id });
    await expect(policy.change(event.eventId, { ...preview.request, transitionId: randomUUID() })).rejects.toBeInstanceOf(ConflictException);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.eventId } })).attendanceRevision).toBe(1);
  });

  it('automatically seats only attendees confirmed for the selected venue', async () => {
    const event = await fixture();
    await change(event.eventId, 'PER_VENUE');
    await host.record(event.eventId, event.guest.id, { attendanceRevision: 2, venueAttendance: [{ venueId: event.hall.id, status: 'DECLINED' }, { venueId: event.church.id, status: 'ATTENDING' }] });
    expect(await seating.autoAssign(event.eventId, event.tables[0].arrangementId)).toMatchObject({ seated: 0, attendanceRevision: 2 });
    expect(await seating.autoAssign(event.eventId, event.tables[1].arrangementId)).toMatchObject({ seated: 1 });
    expect(await seating.autoAssign(event.eventId, `legacy:${event.eventId}`)).toMatchObject({ seated: 0 });
  });

  it('adds pending attendance for a new venue and guards hiding/deleting answered venues', async () => {
    const event = await fixture();
    await change(event.eventId, 'PER_VENUE');
    await host.record(event.eventId, event.guest.id, { attendanceRevision: 2, venueAttendance: [event.hall, event.church].map((venue) => ({ venueId: venue.id, status: 'DECLINED' })) });
    expect((await prisma.rsvp.findUniqueOrThrow({ where: { guestId: event.guest.id } })).status).toBe('DECLINED');
    await venuesService.create(event.eventId, { role: 'AFTER_PARTY', name: 'Later', address: '3 Test St' });
    expect((await prisma.rsvp.findUniqueOrThrow({ where: { guestId: event.guest.id } })).status).toBe('PENDING');
    await expect(venuesService.update(event.eventId, event.hall.id, { role: 'PREPARATION' })).rejects.toBeInstanceOf(ConflictException);
    await expect(timeline.create(event.eventId, { venueId: event.hall.id, isInternal: true, occursAt: new Date().toISOString(), label: { en: 'Private' } })).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.timelineEntry.count()).toBe(0);
    await expect(venuesService.remove(event.eventId, event.hall.id)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('counts people once and scopes catering/bar to the selected venue', async () => {
    const event = await fixture();
    await change(event.eventId, 'PER_VENUE');
    await host.record(event.eventId, event.guest.id, { attendanceRevision: 2, dietary: ['vegetarian'], drinkPreference: 'wine', venueAttendance: [{ venueId: event.hall.id, status: 'ATTENDING' }, { venueId: event.church.id, status: 'DECLINED' }] });
    const operations = new OperationsService(prisma as unknown as PrismaService, {} as never);
    expect(await operations.headcount(event.eventId)).toMatchObject({ attending: 1, venues: [expect.objectContaining({ venueId: event.hall.id, attending: 1 }), expect.objectContaining({ venueId: event.church.id, declined: 1 })] });
    expect(await operations.cateringSheet(event.eventId, event.church.id)).toMatchObject({ covers: 0 });
    expect(await operations.barSheet(event.eventId, event.hall.id)).toMatchObject({ totalResponses: 1 });
  });

  it('rejects foreign/hidden/duplicate venue answers atomically and keeps closed policy responses immutable', async () => {
    const event = await fixture();
    const foreign = await seedEvent(prisma);
    const venue = await prisma.venue.findFirstOrThrow({ where: { eventId: foreign.eventId } });
    await rsvp.submit(event.slug, event.primaryGuestToken, { status: 'ATTENDING' });
    await change(event.eventId, 'PER_VENUE');
    const valid = { venueId: event.hall.id, status: 'ATTENDING' as const };
    for (const answers of [[valid, { venueId: venue.id, status: 'ATTENDING' as const }], [valid, valid]]) {
      await expect(rsvp.submit(event.slug, event.primaryGuestToken, { attendanceRevision: 2, dietaryNotes: 'Must roll back', venueAttendance: answers })).rejects.toBeInstanceOf(BadRequestException);
    }
    expect((await prisma.rsvp.findUniqueOrThrow({ where: { guestId: event.guest.id } })).dietaryNotes).toBeNull();
    await expect(prisma.attendanceResponse.updateMany({ where: { eventId: event.eventId, revision: 1 }, data: { status: 'DECLINED' } })).rejects.toThrow('Historical attendance');
  });
  it('cannot move a historical response into a current policy or reopen the archived policy', async () => {
    const event = await fixture();
    await rsvp.submit(event.slug, event.primaryGuestToken, { status: 'ATTENDING' });
    await change(event.eventId, 'PER_VENUE');
    await change(event.eventId, 'EVENT_WIDE');
    const answer = await prisma.attendanceResponse.findFirstOrThrow({ where: { guestId: event.guest.id, revision: 1 } });
    await expect(prisma.attendanceResponse.update({ where: { id: answer.id }, data: { revision: 3 } })).rejects.toThrow('Attendance identity');
    await expect(prisma.attendancePolicy.updateMany({ where: { eventId: event.eventId, revision: 1 }, data: { isActive: true } })).rejects.toThrow();
    await expect(prisma.event.update({ where: { id: event.eventId }, data: { attendanceRevision: 2, attendanceMode: 'PER_VENUE' } })).rejects.toThrow('active policy');
  });

  it('includes a partially answered person in both response rate and the daily response trend', async () => {
    const event = await fixture();
    await change(event.eventId, 'PER_VENUE');
    await host.record(event.eventId, event.guest.id, { attendanceRevision: 2, venueAttendance: [{ venueId: event.hall.id, status: 'DECLINED' }] });
    const operations = new OperationsService(prisma as unknown as PrismaService, {} as never);
    expect(await operations.headcount(event.eventId)).toMatchObject({
      pending: 1, responseRate: 100, trend: [expect.objectContaining({ responses: 1, cumulative: 1, responseRate: 100 })],
    });
  });

});
