import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventRole, PlatformRole, PrismaClient, EventVisibility } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { authenticateAs } from '../fixtures/auth.fixture';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

/**
 * Where a venue is and how many it holds. Coordinates and capacity were
 * returned to clients and written by nothing — copied only from a directory
 * no one could fill — so the Map block had nothing but a pasted link.
 */
describe('Venue details and the directory (e2e)', () => {
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

  const host = async () => {
    const seeded = await seedEvent(prisma, { visibility: EventVisibility.UNLISTED });
    const { authorization } = await authenticateAs(app, prisma, { eventId: seeded.eventId, role: EventRole.OWNER });
    const venue = await prisma.venue.findFirstOrThrow({ where: { eventId: seeded.eventId } });
    return { ...seeded, authorization, venueId: venue.id };
  };

  const staff = async () => {
    const { authorization, userId } = await authenticateAs(app, prisma);
    await prisma.user.update({ where: { id: userId }, data: { platformRole: PlatformRole.SUPPORT } });
    return authorization;
  };

  const editVenue = (eventId: string, venueId: string, authorization: string, body: Record<string, unknown>) =>
    http().patch(`/api/v1/events/${eventId}/venues/${venueId}`).set('Authorization', authorization).send(body);

  it('places a venue on the map, and guests receive it', async () => {
    const { eventId, slug, venueId, authorization } = await host();
    await prisma.designTemplate.update({ where: { key: 'test-template' }, data: { supportedBlocks: ['HERO', 'MAP', 'RSVP'] } });
    await http()
      .patch(`/api/v1/invitations/${slug}/arrangement`)
      .set('Authorization', authorization)
      .send({ blocks: [{ type: 'HERO' }, { type: 'MAP' }, { type: 'RSVP' }] })
      .expect(200);

    await editVenue(eventId, venueId, authorization, { latitude: 40.1772, longitude: 44.5035, capacity: 220 }).expect(200);

    const { body } = await http().get(`/api/v1/invitations/${slug}`).expect(200);
    const map = (body.blocks as { type: string; data: Record<string, unknown>[] }[]).find((b) => b.type === 'MAP');
    expect(map?.data[0]).toMatchObject({ latitude: 40.1772, longitude: 44.5035 });
  });

  it('clears what is sent as null and keeps the rest', async () => {
    const { eventId, venueId, authorization } = await host();
    await editVenue(eventId, venueId, authorization, {
      latitude: 40.1,
      longitude: 44.5,
      capacity: 100,
      mapUrl: 'https://maps.example/x',
      arriveAt: '2027-06-12T14:30:00Z',
    }).expect(200);

    const { body } = await editVenue(eventId, venueId, authorization, {
      latitude: null,
      longitude: null,
      mapUrl: null,
      arriveAt: null,
    }).expect(200);

    expect(body).toMatchObject({ latitude: null, longitude: null, mapUrl: null, arriveAt: null, capacity: 100 });
  });

  it.each([
    [{ latitude: 40.1 }, 'latitude'],
    [{ latitude: 95, longitude: 44 }, 'latitude'],
    [{ latitude: 40, longitude: 200 }, 'longitude'],
    [{ capacity: 0 }, 'capacity'],
  ])('refuses %j with a 400 naming %s', async (payload, field) => {
    const { eventId, venueId, authorization } = await host();

    const { body } = await editVenue(eventId, venueId, authorization, payload).expect(400);

    expect(JSON.stringify(body.message)).toContain(field);
  });

  // Both used to fail in the database and come back as a 500.
  it('answers a made-up venue role or block type with a 400', async () => {
    const { eventId, slug, authorization } = await host();

    await http()
      .post(`/api/v1/events/${eventId}/venues`)
      .set('Authorization', authorization)
      .send({ role: 'constructor', name: 'X', address: 'Y' })
      .expect(400);
    await http()
      .patch(`/api/v1/invitations/${slug}/blocks/NOPE`)
      .set('Authorization', authorization)
      .send({ content: {} })
      .expect(400);
  });

  it('lets Aveline staff add a hall to the directory, which hosts then copy from', async () => {
    const { eventId, authorization } = await host();
    const staffAuth = await staff();

    const added = await http()
      .post('/api/v1/venue-profiles')
      .set('Authorization', staffAuth)
      .send({ name: 'Garden Hall', address: '12 Garden Lane', city: 'Yerevan', latitude: 40.18, longitude: 44.51, capacity: 300 })
      .expect(201);

    const directory = await http()
      .get(`/api/v1/events/${eventId}/venue-profiles`)
      .query({ city: 'Yerevan' })
      .set('Authorization', authorization)
      .expect(200);
    expect(directory.body).toEqual([expect.objectContaining({ id: added.body.id, name: 'Garden Hall' })]);

    const { body } = await http()
      .post(`/api/v1/events/${eventId}/venues`)
      .set('Authorization', authorization)
      .send({ role: 'RECEPTION', name: 'Garden Hall', address: '12 Garden Lane', profileId: added.body.id, capacity: 180 })
      .expect(201);
    // Coordinates come from the directory; the host's own number of seats wins.
    expect(body).toMatchObject({ latitude: 40.18, longitude: 44.51, capacity: 180 });
  });

  it('keeps a retired hall out of the directory hosts see', async () => {
    const { eventId, authorization } = await host();
    const staffAuth = await staff();
    const added = await http()
      .post('/api/v1/venue-profiles')
      .set('Authorization', staffAuth)
      .send({ name: 'Old Hall', address: '1 Old St' })
      .expect(201);

    await http()
      .patch(`/api/v1/venue-profiles/${added.body.id}`)
      .set('Authorization', staffAuth)
      .send({ isActive: false })
      .expect(200);

    const { body } = await http().get(`/api/v1/events/${eventId}/venue-profiles`).set('Authorization', authorization).expect(200);
    expect(body).toEqual([]);
  });

  // The directory is shared by every customer, so no customer writes to it.
  it('refuses a host who tries to add to the directory', async () => {
    const { authorization } = await host();

    await http()
      .post('/api/v1/venue-profiles')
      .set('Authorization', authorization)
      .send({ name: 'My Hall', address: '1 Main St' })
      .expect(403);
  });
});
