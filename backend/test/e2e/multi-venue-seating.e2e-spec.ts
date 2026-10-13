import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventRole, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { authenticateAs } from '../fixtures/auth.fixture';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

describe('Multi-venue seating contract (e2e)', () => {
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
  afterAll(async () => {
    await app.close();
    await disconnectTestDatabase();
  });

  const fixture = async () => {
    const event = await seedEvent(prisma, { seatsAllotted: 4 });
    await prisma.event.update({ where: { id: event.eventId }, data: { locales: ['en', 'ru', 'fr', 'hy'] } });
    const { authorization } = await authenticateAs(app, prisma, { eventId: event.eventId, role: EventRole.COORDINATOR });
    const guest = await prisma.guest.findUniqueOrThrow({ where: { token: event.primaryGuestToken } });
    await prisma.rsvp.update({ where: { guestId: guest.id }, data: { status: 'ATTENDING' } });
    const venues = [await prisma.venue.findFirstOrThrow({ where: { eventId: event.eventId } }),
      await prisma.venue.create({ data: { eventId: event.eventId, role: 'CEREMONY', name: 'Church', address: '2 Test St' } })];
    const tables = await Promise.all(venues.map((venue) => prisma.table.create({
      data: { eventId: event.eventId, venueId: venue.id, name: 'Table 1', capacity: 4 },
    })));
    await prisma.seat.createMany({ data: tables.map((table) => ({ guestId: guest.id, tableId: table.id })) });
    return { ...event, authorization, guest, venues, tables };
  };

  it('returns arrangements and filters the room without exposing foreign event IDs', async () => {
    const { eventId, authorization, tables } = await fixture();
    const arrangements = await http().get(`/api/v1/events/${eventId}/seating/arrangements`).set('Authorization', authorization).expect(200);
    expect(arrangements.body).toHaveLength(3);
    const room = await http().get(`/api/v1/events/${eventId}/tables`).query({ arrangementId: tables[0].arrangementId }).set('Authorization', authorization).expect(200);
    expect(room.body).toEqual([expect.objectContaining({ id: tables[0].id, arrangementId: tables[0].arrangementId, venue: 'Fixture Hall' })]);
    const foreign = await seedEvent(prisma);
    await http().get(`/api/v1/events/${eventId}/tables`).query({ arrangementId: `legacy:${foreign.eventId}` }).set('Authorization', authorization).expect(404);
  });

  it.each(['en', 'ru', 'fr', 'hy'])('shows only published household assignments in the %s guest flow', async (locale) => {
    const { eventId, slug, primaryGuestToken, authorization, guest, venues } = await fixture();
    const names: Record<string, string> = { en: 'Reception hall', ru: 'Ресторан', fr: 'Salle de réception', hy: 'Հանդիսությունների սրահ' };
    await prisma.venue.update({ where: { id: venues[0].id }, data: { translations: Object.fromEntries(
      Object.entries(names).map(([language, name]) => [language, { name }]),
    ) } });
    const path = `/api/v1/invitations/${slug}/g/${primaryGuestToken}`;
    const before = await http().get(path).query({ locale }).expect(200);
    expect(before.body.guest.seating).toBeNull();
    await http().post(`/api/v1/events/${eventId}/seating/publish`).set('Authorization', authorization).expect(201);
    const after = await http().get(path).query({ locale }).expect(200);
    expect(after.body.locale).toBe(locale);
    expect(after.body.guest.seating.table).toBeNull();
    expect(after.body.guest.seating.assignments).toHaveLength(2);
    expect((after.body.guest.seating.household as { id: string }[]).map((member) => member.id)).toEqual([guest.id]);
    expect((after.body.guest.seating.assignments as { venue: string }[]).map((seat) => seat.venue).sort()).toEqual(['Church', names[locale]].sort());
  });

  it('hides preparation and internal-only venue assignments as well as their names', async () => {
    const { eventId, slug, primaryGuestToken, authorization, guest } = await fixture();
    const preparation = await prisma.venue.create({ data: { eventId, role: 'PREPARATION', name: 'Private home', address: 'Secret address' } });
    const internal = await prisma.venue.create({ data: { eventId, role: 'AFTER_PARTY', name: 'Crew room', address: 'Backstage' } });
    await prisma.timelineEntry.create({ data: { eventId, venueId: internal.id, isInternal: true, occursAt: new Date(), label: { en: 'Crew briefing' } } });
    for (const venue of [preparation, internal]) {
      const table = await prisma.table.create({ data: { eventId, venueId: venue.id, name: 'Secret table', capacity: 4 } });
      await prisma.seat.create({ data: { guestId: guest.id, tableId: table.id } });
    }
    await http().post(`/api/v1/events/${eventId}/seating/publish`).set('Authorization', authorization).expect(201);
    const response = await http().get(`/api/v1/invitations/${slug}/g/${primaryGuestToken}`).expect(200);
    expect(response.body.guest.seating.assignments).toHaveLength(2);
    expect(JSON.stringify(response.body)).not.toMatch(/Private home|Crew room|Secret address|Secret table|Backstage/);
  });

  it('returns all seating assignments at check-in and in venue-labelled CSV outputs', async () => {
    const { eventId, authorization, guest } = await fixture();
    const arrival = await http().post(`/api/v1/events/${eventId}/guests/${guest.id}/check-in`).set('Authorization', authorization).expect(201);
    expect(arrival.body.table).toBeNull();
    expect(arrival.body.seating).toHaveLength(2);
    const totals = await http().get(`/api/v1/events/${eventId}/arrivals`).set('Authorization', authorization).expect(200);
    expect(totals.body).toMatchObject({ expected: 1, arrived: 1, stillToCome: 0, unexpected: 0 });
    for (const kind of ['SEATING_CHART', 'PLACE_CARDS', 'GUEST_LIST']) {
      const exportRequest = await http().post(`/api/v1/events/${eventId}/exports`).set('Authorization', authorization).send({ kind }).expect(201);
      const file = await http().get(exportRequest.body.downloadPath as string).set('Authorization', authorization).expect(200);
      expect(file.text).toContain('Church');
      expect(file.text).toContain('Fixture Hall');
    }
  });

  it('rejects an ambiguous destructive request with a field error and accepts an explicit selection', async () => {
    const { eventId, authorization, guest, tables } = await fixture();
    const path = `/api/v1/events/${eventId}/seats/${guest.id}`;
    const rejected = await http().delete(path).set('Authorization', authorization).expect(400);
    expect(rejected.body.message).toMatch(/^arrangementId:/);
    await http().delete(path).query({ arrangementId: tables[0].arrangementId }).set('Authorization', authorization).expect(200);
    expect(await prisma.seat.count({ where: { guestId: guest.id } })).toBe(1);
  });

  it('protects arrangement reads and mutations with existing event permissions', async () => {
    const { eventId, tables, guest } = await fixture();
    const viewer = await authenticateAs(app, prisma, { eventId, role: EventRole.VIEWER });
    await http().get(`/api/v1/events/${eventId}/seating/arrangements`).expect(401);
    await http().get(`/api/v1/events/${eventId}/seating/arrangements`).set('Authorization', viewer.authorization).expect(200);
    await http().delete(`/api/v1/events/${eventId}/seats/${guest.id}`).query({ arrangementId: tables[0].arrangementId }).set('Authorization', viewer.authorization).expect(403);
  });

  it('refuses venue capacity shrinkage below the seated headcount and can remove an unused venue', async () => {
    const { eventId, authorization, venues, tables, householdId } = await fixture();
    const extra = await prisma.guest.create({ data: { eventId, householdId, firstName: 'Extra', token: `extra-${eventId}` } });
    await prisma.seat.create({ data: { guestId: extra.id, tableId: tables[0].id } });
    const update = await http().patch(`/api/v1/events/${eventId}/venues/${venues[0].id}`).set('Authorization', authorization).send({ capacity: 1 }).expect(400);
    expect(JSON.stringify(update.body.message)).toContain('capacity');
    await http().patch(`/api/v1/events/${eventId}/venues/${venues[0].id}`).set('Authorization', authorization).send({ capacity: 2 }).expect(200);
    const unused = await prisma.venue.create({ data: { eventId, role: 'AFTER_PARTY', name: 'Unused', address: 'Later' } });
    await http().delete(`/api/v1/events/${eventId}/venues/${unused.id}`).set('Authorization', authorization).expect(200);
    expect(await prisma.seatingArrangement.count({ where: { venueId: unused.id } })).toBe(0);
  });

});
