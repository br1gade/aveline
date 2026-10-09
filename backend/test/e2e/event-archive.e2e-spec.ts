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
 * Putting an event away. Decided 9 October 2026: archiving is always allowed
 * and reversible; deleting for good is allowed only for an event that was
 * never published and never took money — so nobody's invitation or payment
 * record vanishes.
 */
describe('Archiving and deleting an event (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  const http = () => request(app.getHttpServer() as Server);

  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

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

  const owner = async (options: { isPublished?: boolean } = {}, role: EventRole = EventRole.OWNER) => {
    const seeded = await seedEvent(prisma, options);
    if (options.isPublished === false) {
      await prisma.event.update({ where: { id: seeded.eventId }, data: { status: 'DRAFT' } });
    }
    const { authorization } = await authenticateAs(app, prisma, { eventId: seeded.eventId, role });
    return { ...seeded, authorization };
  };

  const act = (method: 'post' | 'delete', path: string, authorization: string) =>
    http()[method](`/api/v1${path}`).set('Authorization', authorization);

  const listed = async (authorization: string, query: Record<string, string> = {}) =>
    ((await http().get('/api/v1/events').query(query).set('Authorization', authorization).expect(200)).body as { id: string }[]).map(
      (event) => event.id,
    );

  it('archives an event: off the list, its invitation closed to answers but still readable', async () => {
    const { eventId, slug, primaryGuestToken, authorization } = await owner();

    const { body } = await act('post', `/events/${eventId}/archive`, authorization).expect(201);

    expect(body).toMatchObject({ status: 'ARCHIVED' });
    expect(await listed(authorization)).toEqual([]);
    expect(await listed(authorization, { archived: 'true' })).toEqual([eventId]);
    await http().get(`/api/v1/invitations/${slug}`).expect(200);
    await http()
      .post(`/api/v1/invitations/${slug}/g/${primaryGuestToken}/rsvp`)
      .send({ status: 'ATTENDING' })
      .expect(400);
  });

  it('will not reopen the invitation of an archived event', async () => {
    const { eventId, slug, authorization } = await owner();
    await act('post', `/events/${eventId}/archive`, authorization).expect(201);

    const { body } = await act('post', `/invitations/${slug}/reopen`, authorization).expect(400);

    expect(body.message).toMatch(/archived/i);
  });

  it('brings an archived event back as it was, ready to be reopened', async () => {
    const { eventId, slug, authorization } = await owner();
    await act('post', `/events/${eventId}/archive`, authorization).expect(201);

    const { body } = await act('post', `/events/${eventId}/unarchive`, authorization).expect(201);

    expect(body).toMatchObject({ status: 'PUBLISHED' });
    expect(await listed(authorization)).toEqual([eventId]);
    await act('post', `/invitations/${slug}/reopen`, authorization).expect(201);
  });

  it('deletes an event that was never published, files and all', async () => {
    const { eventId, authorization } = await owner({ isPublished: false });
    const upload = await http()
      .post(`/api/v1/events/${eventId}/media`)
      .set('Authorization', authorization)
      .attach('file', pixel, { filename: 'photo.png', contentType: 'image/png' })
      .expect(201);

    await act('delete', `/events/${eventId}`, authorization).expect(200);

    expect(await prisma.event.findUnique({ where: { id: eventId } })).toBeNull();
    expect((await fetch(upload.body.url as string)).status).toBe(404);
  });

  // Guests already hold the invitation; deleting would break the link in their messages.
  it('refuses to delete an event that was published, and says to archive it', async () => {
    const { eventId, authorization } = await owner();

    const { body } = await act('delete', `/events/${eventId}`, authorization).expect(409);

    expect(body.message).toMatch(/archive/i);
    expect(await prisma.event.findUnique({ where: { id: eventId } })).not.toBeNull();
  });

  it('refuses to delete an event money moved through, even if never published', async () => {
    const { eventId, authorization } = await owner({ isPublished: false });
    const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    await prisma.payment.create({
      data: {
        organizationId: event.organizationId,
        eventId,
        orderNumber: `order-${eventId}`,
        idempotencyKey: `key-${eventId}`,
        purpose: 'DEPOSIT',
        provider: 'FAKE',
        amountMinor: 5000n,
        currency: 'AMD',
        description: 'Deposit',
      },
    });

    await act('delete', `/events/${eventId}`, authorization).expect(409);
  });

  it('refuses a coordinator, who runs the event but does not own it', async () => {
    const { eventId, authorization } = await owner({}, EventRole.COORDINATOR);

    await act('post', `/events/${eventId}/archive`, authorization).expect(403);
    await act('delete', `/events/${eventId}`, authorization).expect(403);
  });
});
