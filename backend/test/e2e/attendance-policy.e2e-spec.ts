import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventRole, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { authenticateAs } from '../fixtures/auth.fixture';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

describe('Attendance policy contract (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const http = () => request(app.getHttpServer() as Server);
  beforeAll(async () => {
    prisma = testPrisma();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  beforeEach(() => resetTestDatabase());
  afterAll(async () => { await app.close(); await disconnectTestDatabase(); });

  it('requires a preview, exposes fresh venue answers and rejects old RSVP forms', async () => {
    const event = await seedEvent(prisma);
    const { authorization } = await authenticateAs(app, prisma, { eventId: event.eventId, role: EventRole.OWNER });
    const policyPath = `/api/v1/events/${event.eventId}/attendance-policy`;
    const preview = await http().post(`${policyPath}/preview`).set('Authorization', authorization).send({ mode: 'PER_VENUE' }).expect(201);
    expect(preview.body).toMatchObject({ expectedRevision: 1, mode: 'PER_VENUE', affected: { guests: 1 } });
    const applied = await http().post(policyPath).set('Authorization', authorization).send({ ...preview.body.request, transitionId: randomUUID() }).expect(201);
    expect(applied.body).toMatchObject({ mode: 'PER_VENUE', revision: 2 });
    const guestPath = `/api/v1/invitations/${event.slug}/g/${event.primaryGuestToken}`;
    const page = await http().get(guestPath).expect(200);
    expect(page.body.guest.attendance).toMatchObject({ mode: 'PER_VENUE', revision: 2 });
    const stale = await http().post(`${guestPath}/rsvp`).send({ status: 'ATTENDING' }).expect(409);
    expect(stale.body.message).toContain('attendanceRevision');
  });
  const fixture = async () => {
    const event = await seedEvent(prisma);
    const { authorization } = await authenticateAs(app, prisma, { eventId: event.eventId, role: EventRole.OWNER });
    const path = `/api/v1/events/${event.eventId}/attendance-policy`;
    const preview = await http().post(`${path}/preview`).set('Authorization', authorization).send({ mode: 'PER_VENUE' }).expect(201);
    await http().post(path).set('Authorization', authorization).send({ ...preview.body.request, transitionId: randomUUID() }).expect(201);
    const venue = await prisma.venue.findFirstOrThrow({ where: { eventId: event.eventId } });
    return { ...event, authorization, venue, path, guestPath: `/api/v1/invitations/${event.slug}/g/${event.primaryGuestToken}` };
  };

  it.each(['en', 'ru', 'fr', 'hy'])('shows current answers and translated venue labels in %s', async (locale) => {
    const event = await fixture();
    const names: Record<string, string> = { en: 'Reception', ru: 'Ресторан', fr: 'Réception', hy: 'Հանդիսությունների սրահ' };
    await prisma.event.update({ where: { id: event.eventId }, data: { locales: Object.keys(names) } });
    await prisma.venue.update({ where: { id: event.venue.id }, data: { translations: Object.fromEntries(Object.entries(names).map(([language, name]) => [language, { name }])) } });
    await http().post(`${event.guestPath}/rsvp`).send({ attendanceRevision: 2, venueAttendance: [{ venueId: event.venue.id, status: 'ATTENDING' }], locale }).expect(201);
    const page = await http().get(event.guestPath).query({ locale }).expect(200);
    expect(page.body.guest.attendance).toMatchObject({ mode: 'PER_VENUE', revision: 2, status: 'ATTENDING', needsReconfirmation: false,
      venues: [{ venueId: event.venue.id, venue: names[locale], status: 'ATTENDING' }] });
    // FR-40: the reply form's read names venues in the page's language too.
    const saved = await http().get(`${event.guestPath}/rsvp`).query({ locale }).expect(200);
    expect(saved.body.attendance).toMatchObject({ revision: 2, status: 'ATTENDING', venues: [{ venueId: event.venue.id, venue: names[locale] }] });
  });

  it.each([
    { attendanceRevision: -1, venueAttendance: [] },
    { attendanceRevision: 1.5, venueAttendance: [] },
    { attendanceRevision: 2, venueAttendance: [{ venueId: 'unknown', status: 'PENDING' }] },
    { attendanceRevision: 2, venueAttendance: [] },
    { attendanceRevision: 2, status: 'ATTENDING', venueAttendance: [{ venueId: 'unknown', status: 'ATTENDING' }] },
  ])('rejects invalid attendance payload $attendanceRevision/$venueAttendance with a field error', async (body) => {
    const event = await fixture();
    const response = await http().post(`${event.guestPath}/rsvp`).send(body).expect(400);
    expect(JSON.stringify(response.body.message)).toMatch(/attendanceRevision|venueAttendance|status/);
    expect(await prisma.attendanceResponse.count()).toBe(0);
  });

  it('restricts policy changes and attendance history to the appropriate event roles', async () => {
    const event = await fixture();
    const guest = await prisma.guest.findUniqueOrThrow({ where: { token: event.primaryGuestToken } });
    const viewer = await authenticateAs(app, prisma, { eventId: event.eventId, role: EventRole.VIEWER });
    const designer = await authenticateAs(app, prisma, { eventId: event.eventId, role: EventRole.DESIGNER });
    await http().post(`${event.path}/preview`).send({ mode: 'EVENT_WIDE' }).expect(401);
    await http().post(`${event.path}/preview`).set('Authorization', viewer.authorization).send({ mode: 'EVENT_WIDE' }).expect(403);
    const history = `/api/v1/events/${event.eventId}/guests/${guest.id}/attendance-history`;
    await http().get(history).set('Authorization', designer.authorization).expect(403);
    await http().get(history).set('Authorization', viewer.authorization).expect(200);
    const foreign = await seedEvent(prisma);
    const other = await prisma.guest.findUniqueOrThrow({ where: { token: foreign.primaryGuestToken } });
    await http().get(`/api/v1/events/${event.eventId}/guests/${other.id}/attendance-history`).set('Authorization', event.authorization).expect(404);
  });

  it('keeps unanswered reservations visible and exposes venue-scoped operations', async () => {
    const event = await fixture();
    const guest = await prisma.guest.findUniqueOrThrow({ where: { token: event.primaryGuestToken } });
    const table = await prisma.table.create({ data: { eventId: event.eventId, venueId: event.venue.id, name: 'Reserved', capacity: 2 } });
    await http().post(`/api/v1/events/${event.eventId}/seats`).set('Authorization', event.authorization).send({ guestId: guest.id, tableId: table.id }).expect(201);
    await http().post(`/api/v1/events/${event.eventId}/seating/publish`).set('Authorization', event.authorization).expect(201);
    const page = await http().get(event.guestPath).expect(200);
    expect(page.body.guest.seating.assignments).toEqual([expect.objectContaining({ table: 'Reserved', isReservation: true })]);
    const counts = await http().get(`/api/v1/events/${event.eventId}/headcount`).set('Authorization', event.authorization).expect(200);
    expect(counts.body).toMatchObject({ attending: 0, pending: 1, venues: [expect.objectContaining({ pending: 1 })] });
    await http().get(`/api/v1/events/${event.eventId}/catering-sheet`).query({ venueId: event.venue.id }).set('Authorization', event.authorization).expect(200);
    await http().get(`/api/v1/events/${event.eventId}/bar-sheet`).query({ venueId: 'foreign' }).set('Authorization', event.authorization).expect(404);
  });

});
