import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
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

  /** Public routes other than the guest's own page keep the tight limit. */
  const burstFrom = async (forwardedFor: string) => {
    const responses = await Promise.all(
      Array.from({ length: BURST }, () =>
        http().get('/api/v1/public/events/no-such-slug').set('X-Forwarded-For', forwardedFor),
      ),
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
        http().get('/api/v1/public/events/no-such-slug').set('X-Forwarded-For', '203.0.113.21'),
      ),
    );

    expect(second.map((response) => response.status)).toEqual([404, 404, 404]);
  });

  // B81: guests on the venue's Wi-Fi share one address, and opening their
  // invitation to find their table counted against one allowance — 429s.
  it('lets a whole room of guests on one address open their invitations', async () => {
    const responses = await Promise.all(
      Array.from({ length: 40 }, () =>
        http().get('/api/v1/invitations/no-such-slug/g/some-token').set('X-Forwarded-For', '203.0.113.30'),
      ),
    );

    expect(responses.filter((response) => response.status === 429)).toHaveLength(0);
  });

  it('counts signed-in staff per account, not per address', async () => {
    const register = async (email: string) =>
      (await http().post('/api/v1/auth/register').set('X-Forwarded-For', `198.51.100.${email.length}`).send({ email, password: 'a-long-enough-password', name: 'Staff' })).body as { accessToken: string };
    const first = await register('door-one@test.local');
    const second = await register('door-two-staff@test.local');
    const list = (token: string) => http().get('/api/v1/events').set('X-Forwarded-For', '203.0.113.40').set('Authorization', `Bearer ${token}`);

    await Promise.all(Array.from({ length: BURST }, () => list(first.accessToken)));
    const theirs = await Promise.all(Array.from({ length: 3 }, () => list(second.accessToken)));

    expect(theirs.map((response) => response.status)).toEqual([200, 200, 200]);
  });
});
