import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { LOGIN_FAILURE_LIMIT, LoginAttempts } from '../../../src/infra/auth/login-attempts';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { tokenFrom } from '../../fixtures/areas/auth-accounts.fixture';
import { UNTHROTTLED } from '../../fixtures/unthrottled.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

/**
 * Failed sign-ins are counted per account (audit F-29). The per-address
 * throttle is off here so that only this limit can answer 429.
 */
describe('Repeated failed sign-ins', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const credentials = { email: 'owner@test.local', password: 'a-long-enough-password', name: 'Owner' };
  const http = () => request(app.getHttpServer() as Server);
  const signIn = (password: string) => http().post('/api/v1/auth/login').send({ email: credentials.email, password });
  const failTimes = async (count: number) => {
    for (let attempt = 0; attempt < count; attempt += 1) await signIn('not-the-password').expect(401);
  };

  beforeAll(async () => {
    prisma = testPrisma();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(prisma)
      .overrideProvider(ThrottlerStorage).useValue(UNTHROTTLED)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  beforeEach(async () => {
    await resetTestDatabase();
    // The count lives in Redis, which no test reset clears.
    await app.get(LoginAttempts).recordSuccess(credentials.email);
    await http().post('/api/v1/auth/register').send(credentials).expect(202);
  });
  afterAll(async () => {
    await app.get(LoginAttempts).recordSuccess(credentials.email);
    await app.close();
    await disconnectTestDatabase();
  });

  it(`signs in with the right password after ${LOGIN_FAILURE_LIMIT - 1} failures`, async () => {
    await failTimes(LOGIN_FAILURE_LIMIT - 1);
    await signIn(credentials.password).expect(201);
  });

  it(`asks the account to wait after ${LOGIN_FAILURE_LIMIT} failures, even with the right password`, async () => {
    await failTimes(LOGIN_FAILURE_LIMIT);

    const { body } = await signIn(credentials.password).expect(429);
    expect(body).toMatchObject({ code: 'LOGIN_TOO_MANY_ATTEMPTS', action: 'WAIT' });
  });

  // The owner's way in while someone else is guessing: the reset proves the mailbox.
  it('signs the owner in on a reset, and lets the new password sign in again, while the account is waiting', async () => {
    await failTimes(LOGIN_FAILURE_LIMIT);
    const requested = await http().post('/api/v1/auth/password-reset').send({ email: credentials.email }).expect(201);

    const confirmed = await http().post('/api/v1/auth/password-reset/confirm')
      .send({ token: tokenFrom(requested.body), password: 'a-brand-new-password' }).expect(201);
    const session = confirmed.body as { accessToken: string };

    expect(session).toMatchObject({ ok: true, sessionsRevoked: true, tokenType: 'Bearer' });
    await http().get('/api/v1/me').set('Authorization', `Bearer ${session.accessToken}`).expect(200);
    await signIn('a-brand-new-password').expect(201);
  });

  it('starts counting again after a successful sign-in', async () => {
    await failTimes(LOGIN_FAILURE_LIMIT - 1);
    await signIn(credentials.password).expect(201);
    await failTimes(LOGIN_FAILURE_LIMIT - 1);
    await signIn(credentials.password).expect(201);
  });
});
