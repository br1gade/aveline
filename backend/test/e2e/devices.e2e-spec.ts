import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { authenticateAs } from '../fixtures/auth.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

/**
 * Push device registration. B55: any signed-in account could revoke another's
 * device by naming its token.
 */
/** A registration token as long as a real one. */
const DEVICE = 'apns-device-token-0123456789abcdef';

describe('Push devices (e2e)', () => {
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

  const register = (authorization: string, token: string) =>
    http().post('/api/v1/devices').set('Authorization', authorization).send({ platform: 'IOS', token });
  const revoke = (authorization: string, token: string) =>
    http().delete(`/api/v1/devices/${token}`).set('Authorization', authorization);
  const isLive = async (token: string) =>
    (await prisma.deviceToken.findUniqueOrThrow({ where: { token } })).revokedAt === null;

  it('registers a device once, however often it re-registers', async () => {
    const { authorization } = await authenticateAs(app, prisma);

    await register(authorization, DEVICE).expect(201);
    await register(authorization, DEVICE).expect(201);

    expect(await prisma.deviceToken.count()).toBe(1);
  });

  it('lets an account stop its own device', async () => {
    const { authorization } = await authenticateAs(app, prisma);
    await register(authorization, DEVICE).expect(201);

    await revoke(authorization, DEVICE).expect(200);

    expect(await isLive(DEVICE)).toBe(false);
  });

  it('will not let one account stop another\'s device', async () => {
    const owner = await authenticateAs(app, prisma);
    const stranger = await authenticateAs(app, prisma);
    await register(owner.authorization, DEVICE).expect(201);

    await revoke(stranger.authorization, DEVICE).expect(404);

    expect(await isLive(DEVICE)).toBe(true);
  });

  // A token comes only from the device itself; one presenting it again under
  // another account is that device signed in as someone else.
  it('moves a device to the account now signed in on it', async () => {
    const first = await authenticateAs(app, prisma);
    const second = await authenticateAs(app, prisma);
    await register(first.authorization, DEVICE).expect(201);

    await register(second.authorization, DEVICE).expect(201);

    expect((await prisma.deviceToken.findUniqueOrThrow({ where: { token: DEVICE } })).userId).toBe(second.userId);
  });
});
