import type { NestExpressApplication } from '@nestjs/platform-express';
import { MessageChannel, PrismaClient } from '@prisma/client';
import { hashSync } from 'bcrypt';
import request from 'supertest';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

/**
 * The mirror of the production factory suite: the same `createApplication()`
 * outside production keeps its development conveniences, so the production
 * refusals there are the environment's doing and not the factory's.
 */
const DEVELOPMENT = { NODE_ENV: 'test', CORS_ORIGINS: undefined, TRUST_PROXY_HOPS: undefined, LOG_LEVEL: 'silent' };

describe('createApplication() under NODE_ENV=test (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  const saved: Record<string, string | undefined> = {};

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    prisma = testPrisma();
    await resetTestDatabase();
    for (const [key, value] of Object.entries(DEVELOPMENT)) {
      saved[key] = process.env[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    const { createApplication } = await import('../../../src/application');
    app = await createApplication();
    await app.listen(0);
  });

  beforeEach(() => resetTestDatabase());

  afterAll(async () => {
    await app.close();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await disconnectTestDatabase();
  });

  it('allows any origin, with credentials', async () => {
    const response = await http().options('/api/v1/auth/login').set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'POST').expect(204);

    expect(response.headers).toMatchObject({
      'access-control-allow-origin': 'http://localhost:5173',
      'access-control-allow-credentials': 'true',
      'access-control-max-age': '600',
    });
  });

  it('serves the schema page', async () => {
    const { body } = await http().get('/docs-json').expect(200);

    expect(body.info.title).toBe('Aveline API');
  });

  it('trusts no proxy when TRUST_PROXY_HOPS is unset', () => {
    expect(app.getHttpAdapter().getInstance().get('trust proxy')).toBeFalsy();
  });

  it('returns the password-reset link in the response alongside the email', async () => {
    await prisma.messageTemplate.create({ data: { organizationId: null, key: 'account.password-reset', channel: MessageChannel.EMAIL, subject: { hy: 'reset' }, body: { hy: '{{link}}' } } });
    await prisma.user.create({ data: { email: 'host@test.local', name: 'Host', passwordHash: hashSync('a-long-enough-password', 4) } });

    const { body } = await http().post('/api/v1/auth/password-reset').send({ email: 'host@test.local' }).expect(201);

    expect(body).toEqual({ sent: true, devLink: expect.stringMatching(/\/reset-password\?token=\w+$/) });
    const message = await prisma.message.findFirstOrThrow({ where: { templateKey: 'account.password-reset', toAddress: 'host@test.local' } });
    expect(message.body).toBe(body.devLink);
  });
});
