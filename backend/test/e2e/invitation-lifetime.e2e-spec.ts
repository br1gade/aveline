import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { seedEvent } from '../fixtures/event.fixture';
import { authenticateAs } from '../fixtures/auth.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

describe('Invitation lifetime (HTTP)', () => {
  let prisma: PrismaClient; let app: INestApplication;
  const http = () => request(app.getHttpServer() as Server);
  beforeAll(async () => {
    prisma = testPrisma();
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    app = module.createNestApplication(); app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })); await app.init();
  });
  beforeEach(() => resetTestDatabase());
  afterAll(async () => { await app.close(); await disconnectTestDatabase(); });
  const setup = async () => {
    const event = await seedEvent(prisma, { isPublished: false, visibility: 'UNLISTED' });
    const host = await authenticateAs(app, prisma, { eventId: event.eventId });
    const startsAt = new Date(Date.now() + 30 * 86_400_000); const endsAt = new Date(startsAt.getTime() + 86_400_000);
    await prisma.event.update({ where: { id: event.eventId }, data: { startsAt, endsAt } });
    return { ...event, ...host, startsAt, endsAt, base: `/api/v1/invitations/${event.slug}` };
  };
  it('captures 90 days after event end and exposes the retained lifetime to the host', async () => {
    const event = await setup();
    const published = await http().post(`${event.base}/publish`).set('Authorization', event.authorization).expect(201);
    const expiresAt = new Date(event.endsAt.getTime() + 90 * 86_400_000).toISOString();
    expect(published.body).toMatchObject({ lifetimeDays: 90, lifetimeSource: 'FREE_DEFAULT', expiresAt });
    const host = await http().get(`/api/v1/events/${event.eventId}`).set('Authorization', event.authorization).expect(200);
    expect(host.body.invitation).toMatchObject({ lifetimeDays: 90, expiresAt, firstPublishedAt: expect.any(String) });
    await http().post(`${event.base}/close`).set('Authorization', event.authorization).expect(201);
    const reopened = await http().post(`${event.base}/reopen`).set('Authorization', event.authorization).expect(201);
    expect(reopened.body.expiresAt).toBe(expiresAt); expect(reopened.body.firstPublishedAt).toBe(published.body.firstPublishedAt);
  });
  it('moves the captured expiry when event dates change without deleting guest data', async () => {
    const event = await setup(); await http().post(`${event.base}/publish`).set('Authorization', event.authorization).expect(201);
    const editedEnd = new Date(event.endsAt.getTime() + 5 * 86_400_000);
    const edited = await http().patch(`/api/v1/events/${event.eventId}`).set('Authorization', event.authorization).send({ endsAt: editedEnd.toISOString() }).expect(200);
    expect(edited.body.invitation.expiresAt).toBe(new Date(editedEnd.getTime() + 90 * 86_400_000).toISOString());
    expect(await prisma.guest.count({ where: { eventId: event.eventId } })).toBe(1);
  });
  it.each(['', '/g/TOKEN', '/g/TOKEN/rsvp', '/g/TOKEN/acknowledgements', '/g/TOKEN/gallery'])('closes expired guest reads at %s while retaining host access', async (suffix) => {
    const event = await setup(); await http().post(`${event.base}/publish`).set('Authorization', event.authorization).expect(201);
    const path = `${event.base}${suffix.replace('TOKEN', event.primaryGuestToken)}`;
    await http().get(path).expect(200);
    await prisma.invitation.update({ where: { slug: event.slug }, data: { expiresAt: new Date(0) } });
    await http().get(path).expect(404);
    await http().get(`/api/v1/events/${event.eventId}`).set('Authorization', event.authorization).expect(200);
    expect(await prisma.guest.count({ where: { eventId: event.eventId } })).toBe(1);
  });
  it('refuses expired guest writes and refuses to send a new dead invitation link', async () => {
    const event = await setup(); await http().post(`${event.base}/publish`).set('Authorization', event.authorization).expect(201);
    await prisma.invitation.update({ where: { slug: event.slug }, data: { expiresAt: new Date(0) } });
    const personal = `${event.base}/g/${event.primaryGuestToken}`;
    await http().post(`${personal}/rsvp`).send({ status: 'ATTENDING' }).expect(400);
    await http().patch(`${personal}/name`).send({ firstName: 'Changed' }).expect(404);
    await http().post(`${personal}/gallery`).attach('file', Buffer.from('staged'), { filename: 'x.png', contentType: 'image/png' }).expect(404);
    await http().post(`${event.base}/send`).set('Authorization', event.authorization).send({}).expect(400);
    expect(await prisma.guestMedia.count()).toBe(0);
    expect(await prisma.message.count()).toBe(0);
  });

  it.each(['', '/g/TOKEN'])('prevents downstream caching of available and expired pages at %s', async (suffix) => {
    const event = await seedEvent(prisma, { visibility: 'UNLISTED' });
    const path = `/api/v1/invitations/${event.slug}${suffix.replace('TOKEN', event.primaryGuestToken)}`;
    await http().get(path).expect('Cache-Control', 'private, no-store').expect(200);
    await prisma.invitation.update({ where: { slug: event.slug }, data: { expiresAt: new Date(0) } });
    await http().get(path).expect('Cache-Control', 'private, no-store').expect(404);
  });

});
