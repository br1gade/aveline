import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { AuthService } from '../../src/infra/auth/auth.service';
import { hashRefreshToken } from '../../src/infra/auth/token.util';
import { PrismaService } from '../../src/prisma/prisma.service';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

const SOURCE_TOKEN = 'source-session-token'.repeat(3);
const OTHER_TOKEN = 'other-session-token'.repeat(3);
const JWT_SECRET = 'isolated-session-rotation-integration-secret';

describe('refresh rotation evidence and atomic replacement', () => {
  let prisma: PrismaClient;
  beforeAll(() => { prisma = testPrisma(); });
  beforeEach(() => resetTestDatabase());
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => disconnectTestDatabase());

  const service = (client: unknown = prisma, jwt = new JwtService({ secret: JWT_SECRET })) =>
    new AuthService(client as PrismaService, jwt, new ConfigService());

  const sessions = async () => {
    const user = await prisma.user.create({ data: { email: 'rotation@example.test', name: 'Session regression' } });
    await prisma.session.createMany({ data: [SOURCE_TOKEN, OTHER_TOKEN].map((token) => ({
      userId: user.id, tokenHash: hashRefreshToken(token), expiresAt: new Date('2100-01-01T00:00:00Z'),
    })) });
    return user;
  };

  it.each(['single logout', 'legacy revocation'])('rejects a token from %s without revoking unrelated sessions', async (origin) => {
    const user = await sessions();
    const auth = service();
    if (origin === 'single logout') await auth.logout(SOURCE_TOKEN);
    await prisma.session.update({ where: { tokenHash: hashRefreshToken(SOURCE_TOKEN) }, data: { revokedAt: new Date('2000-01-01T00:00:00Z') } });
    await expect(auth.refresh(SOURCE_TOKEN, {})).rejects.toBeInstanceOf(UnauthorizedException);
    expect(await prisma.session.findUniqueOrThrow({ where: { tokenHash: hashRefreshToken(OTHER_TOKEN) } })).toMatchObject({ revokedAt: null });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).sessionGeneration).toBe(0);
  });

  it.each(['session creation', 'token signing'])('rolls revocation back if %s fails, so retry can still succeed', async (stage) => {
    await sessions();
    const failure = new Error('controlled replacement failure');
    const jwt = new JwtService({ secret: JWT_SECRET });
    const client = stage === 'session creation'
      ? prisma.$extends({ query: { session: { create: () => Promise.reject(failure) } } }) : prisma;
    if (stage === 'token signing') jest.spyOn(jwt, 'signAsync').mockRejectedValue(failure);
    await expect(service(client, jwt).refresh(SOURCE_TOKEN, {})).rejects.toThrow('controlled replacement failure');
    expect(await prisma.session.findUniqueOrThrow({ where: { tokenHash: hashRefreshToken(SOURCE_TOKEN) } })).toMatchObject({ revokedAt: null, rotatedAt: null });
    expect(await prisma.session.count({ where: { revokedAt: null } })).toBe(2);
    const result = await service().refresh(SOURCE_TOKEN, {});
    expect(result.refreshToken).not.toBe(SOURCE_TOKEN);
    expect(await prisma.session.findUniqueOrThrow({ where: { tokenHash: hashRefreshToken(SOURCE_TOKEN) } })).toMatchObject({ revokedAt: expect.any(Date), rotatedAt: expect.any(Date) });
  });
});
