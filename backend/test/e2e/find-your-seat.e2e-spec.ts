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

/**
 * Find your seat. Decided 9 October 2026 (D4): a guest sees their table only
 * through their own link, and only once the host publishes the seating.
 *
 * The lookup it replaces (B16) was keyed by an event id no guest ever saw,
 * and with an empty query listed ten guests' names and tables to anyone, for
 * any event, drafts included.
 */
describe('Find your seat (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  const http = () => request(app.getHttpServer() as Server);

  beforeAll(async () => {
    prisma = testPrisma();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  beforeEach(() => resetTestDatabase());
  afterAll(async () => {
    await app.close();
    await disconnectTestDatabase();
  });

  /** A household of two at Table 3, and a stranger household at Table 7. */
  const seated = async () => {
    const seeded = await seedEvent(prisma, { seatsAllotted: 2 });
    const { eventId, householdId } = seeded;
    const { authorization } = await authenticateAs(app, prisma, { eventId, role: EventRole.COORDINATOR });
    const primary = await prisma.guest.findFirstOrThrow({ where: { eventId, isPrimary: true } });
    const partner = await prisma.guest.create({
      data: { eventId, householdId, firstName: 'Ani', lastName: 'Guest', token: `partner-${eventId}` },
    });
    const strangers = await prisma.household.create({ data: { eventId, name: 'Strangers', seatsAllotted: 1 } });
    const stranger = await prisma.guest.create({
      data: { eventId, householdId: strangers.id, firstName: 'Someone', lastName: 'Else', token: `stranger-${eventId}` },
    });
    const three = await prisma.table.create({ data: { eventId, name: 'Table 3', capacity: 8 } });
    const seven = await prisma.table.create({ data: { eventId, name: 'Table 7', capacity: 8 } });
    await prisma.seat.createMany({
      data: [
        { tableId: three.id, guestId: primary.id },
        { tableId: three.id, guestId: partner.id },
        { tableId: seven.id, guestId: stranger.id },
      ],
    });
    return { ...seeded, authorization };
  };

  const personalPage = (slug: string, token: string) =>
    http().get(`/api/v1/invitations/${slug}/g/${token}`).expect(200);

  const publishSeating = (eventId: string, authorization: string) =>
    http().post(`/api/v1/events/${eventId}/seating/publish`).set('Authorization', authorization);

  it('shows a guest no table while the host is still working on the plan', async () => {
    const { slug, primaryGuestToken } = await seated();

    const { body } = await personalPage(slug, primaryGuestToken);

    expect(body.guest.seating).toBeNull();
  });

  it('shows a guest their own table, and their household’s, once the seating is published', async () => {
    const { eventId, slug, primaryGuestToken, authorization } = await seated();

    const published = await publishSeating(eventId, authorization).expect(201);

    expect(published.body.seatingPublishedAt).toEqual(expect.any(String));
    const { body } = await personalPage(slug, primaryGuestToken);
    expect(body.guest.seating).toEqual({
      table: 'Table 3',
      household: [
        { id: expect.any(String), name: 'Primary Guest', table: 'Table 3' },
        { id: expect.any(String), name: 'Ani Guest', table: 'Table 3' },
      ],
    });
    expect(JSON.stringify(body)).not.toContain('Table 7');
    expect(JSON.stringify(body)).not.toContain('Someone');
  });

  it('says plainly when a guest has no table yet', async () => {
    const { eventId, slug, authorization } = await seated();
    const household = await prisma.household.create({ data: { eventId, name: 'Late', seatsAllotted: 1 } });
    const late = await prisma.guest.create({
      data: { eventId, householdId: household.id, firstName: 'Late', token: `late-${eventId}` },
    });
    await publishSeating(eventId, authorization).expect(201);

    const { body } = await personalPage(slug, late.token);

    expect(body.guest.seating).toEqual({ table: null, household: [{ id: late.id, name: 'Late', table: null }] });
  });

  it('hides the tables again when the host takes the seating back', async () => {
    const { eventId, slug, primaryGuestToken, authorization } = await seated();
    await publishSeating(eventId, authorization).expect(201);

    const { body: withdrawn } = await http()
      .post(`/api/v1/events/${eventId}/seating/unpublish`)
      .set('Authorization', authorization)
      .expect(201);

    expect(withdrawn.seatingPublishedAt).toBeNull();
    expect((await personalPage(slug, primaryGuestToken)).body.guest.seating).toBeNull();
  });

  it('shows nothing about seating on the shared, un-personalized page', async () => {
    const { eventId, slug, authorization } = await seated();
    await publishSeating(eventId, authorization).expect(201);
    await prisma.event.update({ where: { id: eventId }, data: { visibility: 'UNLISTED' } });

    const { body } = await http().get(`/api/v1/invitations/${slug}`).expect(200);

    expect(JSON.stringify(body)).not.toContain('Table 3');
  });

  // B16: anyone could list names and tables for any event.
  it('no longer answers the old lookup by event id', async () => {
    const { eventId, authorization } = await seated();
    await publishSeating(eventId, authorization).expect(201);

    await http().get(`/api/v1/events/${eventId}/find-seat`).query({ q: '' }).expect(404);
  });

  it('lets only someone who may change the seating publish it', async () => {
    const { eventId } = await seated();
    const viewer = await authenticateAs(app, prisma, { eventId, role: EventRole.VIEWER });

    await publishSeating(eventId, viewer.authorization).expect(403);
  });

  it('shows the host whether the seating is published, with the tables', async () => {
    const { eventId, authorization } = await seated();
    await publishSeating(eventId, authorization).expect(201);

    const { body } = await http().get(`/api/v1/events/${eventId}`).set('Authorization', authorization).expect(200);

    expect(body.seatingPublishedAt).toEqual(expect.any(String));
  });
});
