import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { MessageChannel, PaymentProvider, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { ticketEvent } from '../../fixtures/tickets.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

/**
 * The real HTTP factory, `createApplication()`, booted as production.
 *
 * Every other e2e suite rebuilds the app by hand under NODE_ENV=test, so the
 * prefix, the validation pipe, the BigInt interceptor, proxy trust, CORS and
 * the production refusals of development shortcuts were never exercised
 * together the way main.ts serves them (backend/docs/ARCHITECTURE.md, Shared
 * HTTP application setup; root CLAUDE.md: development affordances must be
 * impossible to reach in production).
 *
 * NODE_ENV is production only while the app is built — ConfigModule captures
 * it then — and is put back to test afterwards so the destructive database
 * reset between tests keeps its production refusal.
 */
const PRODUCTION = {
  NODE_ENV: 'production',
  TRUST_PROXY_HOPS: '1',
  CORS_ORIGINS: 'https://aveline.am, https://admin.aveline.am',
  JWT_SECRET: 'production-test-secret-that-is-long-enough-to-be-real',
  PUBLIC_APP_URL: 'https://aveline.am',
  LOG_LEVEL: 'silent',
};

describe('createApplication() under NODE_ENV=production (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let serializeSpy: jest.SpyInstance;
  const saved: Record<string, string | undefined> = {};

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    prisma = testPrisma();
    await resetTestDatabase();
    for (const [key, value] of Object.entries(PRODUCTION)) {
      saved[key] = process.env[key];
      process.env[key] = value;
    }
    const serialize = await import('../../../src/common/interceptors/serialize');
    serializeSpy = jest.spyOn(serialize.SerializeInterceptor.prototype, 'intercept');
    const { createApplication } = await import('../../../src/application');
    app = await createApplication();
    await app.listen(0);
    process.env.NODE_ENV = 'test';
  });

  beforeEach(() => resetTestDatabase());

  afterAll(async () => {
    await app.close();
    serializeSpy.mockRestore();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await disconnectTestDatabase();
  });

  const template = (key: string) =>
    prisma.messageTemplate.create({ data: { organizationId: null, key, channel: MessageChannel.EMAIL, subject: { hy: key }, body: { hy: '{{link}}' } } });

  describe('HTTP wiring', () => {
    it('serves the API under api/v1 and nothing at the bare path', async () => {
      await http().get('/api/v1/health/live').expect(200);
      await http().get('/health/live').expect(404);
      await http().get('/api/health/live').expect(404);
    });

    it('does not publish the schema page in production', async () => {
      await http().get('/docs').expect(404);
      await http().get('/docs-json').expect(404);
    });

    it('trusts exactly the configured number of proxy hops', () => {
      expect(app.getHttpAdapter().getInstance().get('trust proxy')).toBe(1);
    });

    it('rejects an unknown body field with a 400 naming it', async () => {
      const { body } = await http().post('/api/v1/auth/password-reset').send({ email: 'someone@test.local', isAdmin: true }).expect(400);

      expect(body.message).toEqual(['property isAdmin should not exist']);
      expect(body.details).toEqual([{ field: 'isAdmin', code: 'INVALID_FIELD', userMessage: expect.any(String) }]);
    });

    // Most money fields are converted by hand before they reach it, so the
    // interceptor's presence is checked directly: without it the next
    // endpoint that returns a raw BigInt would 500.
    it('passes every response through the BigInt serializer', async () => {
      serializeSpy.mockClear();

      await http().get('/api/v1/health/live').expect(200);

      expect(serializeSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('CORS', () => {
    const preflight = (origin: string) =>
      http().options('/api/v1/auth/login').set('Origin', origin).set('Access-Control-Request-Method', 'POST');

    it('gives a preflight from an unlisted origin no allow-origin header', async () => {
      const response = await preflight('https://evil.test');

      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });

    it.each(['https://aveline.am', 'https://admin.aveline.am'])('echoes the configured origin %s with credentials and a 600 s preflight cache', async (origin) => {
      const response = await preflight(origin).expect(204);

      expect(response.headers).toMatchObject({
        'access-control-allow-origin': origin,
        'access-control-allow-credentials': 'true',
        'access-control-max-age': '600',
      });
    });

    it('exposes the request id to a configured origin', async () => {
      const response = await http().get('/api/v1/health/live').set('Origin', 'https://aveline.am').expect(200);

      expect(response.headers['access-control-expose-headers']).toContain('x-request-id');
      expect(response.headers['x-request-id']).toBeTruthy();
    });
  });

  // AccountService's own production refusal, for every link flow, is pinned
  // in test/integration/areas/auth-accounts.int-spec.ts. This shows the
  // real factory hands it the production environment.
  describe('development links are absent (docs/API.md §9)', () => {
    const signedIn = async () => {
      const seeded = await ticketEvent(prisma);
      const actor = await authenticateAs(app, prisma, { eventId: seeded.eventId, role: 'OWNER' });
      const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
      return { ...seeded, ...actor, email: user.email };
    };

    it('answers a password reset for a real account without devLink, and queues the link by email', async () => {
      await template('account.password-reset');
      const { email } = await signedIn();

      const { body } = await http().post('/api/v1/auth/password-reset').send({ email }).expect(201);

      expect(body).toEqual({ sent: true });
      const message = await prisma.message.findFirstOrThrow({ where: { templateKey: 'account.password-reset', toAddress: email } });
      expect(message.body).toMatch(/^https:\/\/aveline\.am\/reset-password\?token=\w+/);
    });
  });

  describe('the fake payment gateway (backend/docs/ARCHITECTURE.md §7)', () => {
    it('refuses a paid checkout through FAKE, with no payment and no tickets', async () => {
      const event = await ticketEvent(prisma);
      await prisma.ticketType.update({ where: { id: event.ticketTypeId }, data: { priceMinor: 25_000n } });

      const response = await http()
        .post(`/api/v1/public/events/${event.slug}/orders`)
        .send({
          buyerName: 'Buyer', buyerEmail: 'buyer@test.local', idempotencyKey: randomUUID(), provider: PaymentProvider.FAKE,
          items: [{ ticketTypeId: event.ticketTypeId, quantity: 1 }],
          attendees: [{ ticketTypeId: event.ticketTypeId, firstName: 'Anna' }],
        });

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('FAKE is not configured. Set its credentials to enable it.');
      expect(await prisma.payment.count()).toBe(0);
      expect(await prisma.ticket.count()).toBe(0);
    });
  });
});
