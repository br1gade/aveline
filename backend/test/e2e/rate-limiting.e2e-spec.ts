import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { EventRole, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { authenticateAs } from '../fixtures/auth.fixture';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

/**
 * That the rate limiter counts per client, behind a proxy.
 *
 * This is the behaviour, not the configuration. The limiter was per-client in
 * development and silently global in production, because behind a reverse
 * proxy every request arrives from the proxy's address — so one guest opening
 * their invitation could exhaust the limit for everyone. Nothing failed; the
 * product just stopped answering.
 *
 * Asserted over HTTP with forwarded headers because that is the only place the
 * defect was visible: every unit test of the throttler passed throughout.
 */
describe('Rate limiting behind a proxy (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;

  const http = () => request(app.getHttpServer());

  /** The short window is 10 per second, so 12 is comfortably over it. */
  const BURST = 12;

  /** Credential mutations keep the tight limit; guest reads have a larger allowance. */
  const refreshFrom = (forwardedFor: string) => http().post('/api/v1/auth/refresh')
    .set('X-Forwarded-For', forwardedFor).send({ refreshToken: 'unknown-refresh-token'.repeat(3) });

  const burstFrom = async (forwardedFor: string) => {
    const responses = await Promise.all(
      Array.from({ length: BURST }, () => refreshFrom(forwardedFor)),
    );
    return responses.filter((response) => response.status === 429).length;
  };

  beforeAll(async () => {
    prisma = testPrisma();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    // Exactly what docker-compose.prod.yml sets: one proxy, Caddy.
    app.set('trust proxy', 1);
    // Listening on an ephemeral port rather than only initialising. Given an
    // unlistened server, supertest opens a listener per request — and this
    // suite fires a dozen at once, which is how it raised Node's
    // MaxListenersExceeded warning on every run. A warning that is always
    // there is a warning nobody reads, so it is fixed at the source.
    await app.listen(0);
    await resetTestDatabase();
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestDatabase();
  });

  it('throttles a client that floods it', async () => {
    const throttled = await burstFrom('203.0.113.10');

    expect(throttled).toBeGreaterThan(0);
  });

  /**
   * The defect itself. Without `trust proxy` both bursts share one bucket, so
   * the second client is throttled by the first client's traffic — which is
   * every guest being throttled by whoever opened the invitation first.
   */
  it('does not throttle one client because of another', async () => {
    await burstFrom('203.0.113.20');

    // A different client, immediately afterwards, with its own allowance.
    const second = await Promise.all(
      Array.from({ length: 3 }, () =>
        refreshFrom('203.0.113.21'),
      ),
    );

    expect(second.map((response) => response.status)).toEqual([401, 401, 401]);
  });

  // B81: guests on the venue's Wi-Fi share one address, and opening their
  // invitation to find their table counted against one allowance — 429s.
  // FR-147: the price list is read for every visitor to /pricing, from the renderer's one address.
  it.each(['/invitations/no-such-slug/g/some-token', '/public/events/no-such-slug', '/plans'])('allows a room of guests on one address to read %s', async (path) => {
    const responses = await Promise.all(
      Array.from({ length: 40 }, () =>
        http().get(`/api/v1${path}`).set('X-Forwarded-For', '203.0.113.30'),
      ),
    );

    expect(responses.filter((response) => response.status === 429)).toHaveLength(0);
  });

  // FR-142: the door reads a large roster whole, a page at a time, from one account.
  it('lets the door read a large roster without spending the check-in allowance', async () => {
    const { eventId } = await seedEvent(prisma);
    const { authorization } = await authenticateAs(app, prisma, { eventId, role: EventRole.COORDINATOR });

    const responses = await Promise.all(Array.from({ length: 40 }, () =>
      http().get(`/api/v1/events/${eventId}/door-roster`).set('Authorization', authorization)));

    expect(responses.filter((response) => response.status === 429)).toHaveLength(0);
  });

  it('counts signed-in staff per account, not per address', async () => {
    const signIn = async (email: string) => {
      const from = `198.51.100.${email.length}`;
      await http().post('/api/v1/auth/register').set('X-Forwarded-For', from).send({ email, password: 'a-long-enough-password', name: 'Staff' }).expect(202);
      return (await http().post('/api/v1/auth/login').set('X-Forwarded-For', from).send({ email, password: 'a-long-enough-password' }).expect(201)).body as { accessToken: string };
    };
    const first = await signIn('door-one@test.local');
    const second = await signIn('door-two-staff@test.local');
    const list = (token: string) => http().get('/api/v1/events').set('X-Forwarded-For', '203.0.113.40').set('Authorization', `Bearer ${token}`);

    await Promise.all(Array.from({ length: BURST }, () => list(first.accessToken)));
    const theirs = await Promise.all(Array.from({ length: 3 }, () => list(second.accessToken)));

    expect(theirs.map((response) => response.status)).toEqual([200, 200, 200]);
  });
});
