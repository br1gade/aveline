import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

/**
 * The guard is default-on: a route is reachable without a session only if it
 * says so. These tests assert both halves — that organizer surfaces are shut,
 * and that the guest paths the product depends on stayed open.
 */
describe('Authentication (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  const http = () => request(app.getHttpServer() as Server);
  const credentials = { email: 'owner@test.local', password: 'a-long-enough-password', name: 'Owner' };

  beforeAll(async () => {
    prisma = testPrisma();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
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

  describe('registration and login', () => {
    it('issues a token pair on registration', async () => {
      const { body } = await http().post('/api/auth/register').send(credentials).expect(201);

      expect(body).toMatchObject({ tokenType: 'Bearer' });
      expect(typeof body.accessToken).toBe('string');
      expect(typeof body.refreshToken).toBe('string');
    });

    it('never stores the password itself', async () => {
      await http().post('/api/auth/register').send(credentials).expect(201);

      const user = await prisma.user.findUniqueOrThrow({ where: { email: credentials.email } });
      expect(user.passwordHash).not.toBe(credentials.password);
      expect(user.passwordHash).toMatch(/^\$2[aby]\$/);
    });

    it('never stores the refresh token itself', async () => {
      const { body } = await http().post('/api/auth/register').send(credentials).expect(201);

      const session = await prisma.session.findFirstOrThrow();
      expect(session.tokenHash).not.toBe(body.refreshToken);
    });

    it('logs in with the right password', async () => {
      await http().post('/api/auth/register').send(credentials).expect(201);

      await http()
        .post('/api/auth/login')
        .send({ email: credentials.email, password: credentials.password })
        .expect(201);
    });

    it.each([
      { label: 'a wrong password', email: credentials.email, password: 'wrong-password-here' },
      { label: 'an unknown address', email: 'nobody@test.local', password: credentials.password },
    ])('rejects $label with the same 401', async ({ email, password }) => {
      await http().post('/api/auth/register').send(credentials).expect(201);

      const response = await http().post('/api/auth/login').send({ email, password }).expect(401);
      // Identical wording: whether an address has an account is not disclosed.
      expect(response.body.message).toBe('Invalid email or password');
    });

    it('refuses a password shorter than the minimum', async () => {
      await http()
        .post('/api/auth/register')
        .send({ ...credentials, password: 'short' })
        .expect(400);
    });
  });

  describe('refresh token rotation', () => {
    it('exchanges a refresh token for a new pair', async () => {
      const { body: first } = await http().post('/api/auth/register').send(credentials).expect(201);

      const { body: second } = await http()
        .post('/api/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(201);

      expect(second.refreshToken).not.toBe(first.refreshToken);
    });

    // A stolen token must be usable at most once.
    it('revokes the presented token, so replay fails', async () => {
      const { body: first } = await http().post('/api/auth/register').send(credentials).expect(201);
      await http().post('/api/auth/refresh').send({ refreshToken: first.refreshToken }).expect(201);

      await http().post('/api/auth/refresh').send({ refreshToken: first.refreshToken }).expect(401);
    });

    it('rejects a refresh token after logout', async () => {
      const { body } = await http().post('/api/auth/register').send(credentials).expect(201);

      await http().post('/api/auth/logout').send({ refreshToken: body.refreshToken }).expect(201);
      await http().post('/api/auth/refresh').send({ refreshToken: body.refreshToken }).expect(401);
    });

    it('rejects a token that was never issued', async () => {
      await http().post('/api/auth/refresh').send({ refreshToken: 'x'.repeat(64) }).expect(401);
    });
  });

  describe('guarded routes', () => {
    it.each([
      '/api/events',
      '/api/events/any-id/dashboard',
      '/api/events/any-id/guests',
    ])('refuses %s without a token', async (path) => {
      await http().get(path).expect(401);
    });

    it.each([
      { label: 'no scheme', header: 'abcdef' },
      { label: 'the wrong scheme', header: 'Basic abcdef' },
      { label: 'a malformed token', header: 'Bearer not-a-jwt' },
    ])('refuses $label', async ({ header }) => {
      await http().get('/api/events').set('Authorization', header).expect(401);
    });

    // Authenticated but unprivileged: a plain account holds no event role, so
    // the policy denies rather than the guard.
    it('403s an authenticated account with no standing on the event', async () => {
      const { body } = await http().post('/api/auth/register').send(credentials).expect(201);
      const { eventId } = await seedEvent(prisma);

      await http()
        .get(`/api/events/${eventId}/dashboard`)
        .set('Authorization', `Bearer ${body.accessToken}`)
        .expect(403);
    });

    it('allows an owner through to their own event', async () => {
      const { body } = await http().post('/api/auth/register').send(credentials).expect(201);
      const { eventId } = await seedEvent(prisma);
      const user = await prisma.user.findUniqueOrThrow({ where: { email: credentials.email } });
      await prisma.eventMembership.create({
        data: { userId: user.id, eventId, role: 'OWNER' },
      });

      await http()
        .get(`/api/events/${eventId}/dashboard`)
        .set('Authorization', `Bearer ${body.accessToken}`)
        .expect(200);
    });
  });

  describe('public routes stayed public', () => {
    it('serves health without a token', async () => {
      await http().get('/api/health/live').expect(200);
    });

    it('serves an invitation and accepts an RSVP without a token', async () => {
      const { slug, primaryGuestToken } = await seedEvent(prisma);

      await http().get(`/api/invitations/${slug}`).expect(200);
      await http()
        .post(`/api/invitations/${slug}/g/${primaryGuestToken}/rsvp`)
        .send({ status: 'ATTENDING' })
        .expect(201);
    });

    it('serves public event browsing without a token', async () => {
      await http().get('/api/public/events').expect(200);
    });
  });
});
