import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { SerializeInterceptor } from '../../../src/common/interceptors/serialize';
import { ExportRunner } from '../../../src/modules/exports/export-runner';
import { buildPrivateStorage, PRIVATE_STORAGE, PrivateStorage } from '../../../src/infra/storage/private/private-storage';
import { FilesystemStorageAdapter } from '../../../src/infra/storage/adapters/filesystem.adapter';
import { STORAGE_ADAPTER } from '../../../src/infra/storage/storage-port';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { seedEvent } from '../../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

/**
 * How the platform behaves when a dependency is down or a client floods it
 * (docs/API.md §1 Rate limits, §7 Health).
 *
 * Both stores are the real filesystem adapters, wrapped so a test can take
 * them away and give them back — the outage the manual pilot simulates with
 * chmod, without touching the disk.
 */
describe('Platform resilience (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let root: string;
  const outage = { isPublicStorageDown: false, isPrivateStorageDown: false };

  const http = () => request(app.getHttpServer());

  /** Each test gets its own client address, so throttle buckets never leak between tests. */
  let lastHost = 20;
  const address = () => `203.0.113.${++lastHost}`;

  const burst = async (count: number, send: () => request.Test) => {
    const responses = await Promise.all(Array.from({ length: count }, send));
    return responses.map((response) => response.status);
  };

  beforeAll(async () => {
    prisma = testPrisma();
    root = await mkdtemp(join(tmpdir(), 'aveline-resilience-'));
    const publicStore = new FilesystemStorageAdapter(join(root, 'public'), '/files');
    const publicProbe = publicStore.probe.bind(publicStore);
    publicStore.probe = () => (outage.isPublicStorageDown ? Promise.reject(new Error('storage unreachable')) : publicProbe());

    const privateStore = buildPrivateStorage(new ConfigService({ S3_ENDPOINT: '', STORAGE_ROOT: join(root, 'public'), PRIVATE_STORAGE_ROOT: join(root, 'private') }));
    const flakyPrivate: PrivateStorage = {
      put: (key, buffer, mimeType) => privateStore.put(key, buffer, mimeType),
      get: (key) => (outage.isPrivateStorageDown ? Promise.reject(new Error('EACCES: permission denied')) : privateStore.get(key)),
      remove: (key) => privateStore.remove(key),
      probe: () => privateStore.probe(),
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(prisma)
      .overrideProvider(STORAGE_ADAPTER).useValue(publicStore)
      .overrideProvider(PRIVATE_STORAGE).useValue(flakyPrivate)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix('api/v1');
    app.useGlobalInterceptors(new SerializeInterceptor());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    // What docker-compose.prod.yml sets: one proxy. Listening, because the
    // bursts below would otherwise open a listener per request.
    app.set('trust proxy', 1);
    await app.listen(0);
  });

  beforeEach(async () => {
    outage.isPublicStorageDown = false;
    outage.isPrivateStorageDown = false;
    await resetTestDatabase();
  });

  afterAll(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
    await disconnectTestDatabase();
  });

  describe('readiness', () => {
    it('names Postgres as required and up, with how long each probe took', async () => {
      const { body } = await http().get('/api/v1/health/ready').expect(200);

      // Mongo is optional and may be absent here; the status follows it.
      expect(body.status).toBe(body.optional.mongo.isUp ? 'ok' : 'degraded');
      expect(body).toMatchObject({
        required: { postgres: { isUp: true, latencyMs: expect.any(Number) } },
        optional: {
          redis: { isUp: true, latencyMs: expect.any(Number) },
          mongo: { isUp: expect.any(Boolean), latencyMs: expect.any(Number) },
          storage: { isUp: true, latencyMs: expect.any(Number) },
        },
      });
      expect(new Date(body.at as string).toISOString()).toBe(body.at);
    });

    it('stays 200 but degraded with storage down, and says why', async () => {
      outage.isPublicStorageDown = true;

      const { body } = await http().get('/api/v1/health/ready').expect(200);

      expect(body.status).toBe('degraded');
      expect(body.required.postgres.isUp).toBe(true);
      expect(body.optional.storage).toEqual({ isUp: false, latencyMs: expect.any(Number), error: 'storage unreachable' });
    });
  });

  describe('a private storage outage', () => {
    const completedSnapshot = async () => {
      const event = await seedEvent(prisma);
      const actor = await authenticateAs(app, prisma, { eventId: event.eventId, role: 'OWNER' });
      const base = `/api/v1/events/${event.eventId}/export-snapshots`;
      const created = await http().post(base).set('Authorization', actor.authorization).send({ kind: 'GUEST_LIST', format: 'CSV', locale: 'en', idempotencyKey: randomUUID() }).expect(201);
      await app.get(ExportRunner).runOne();
      return { ...event, ...actor, download: `${base}/${(created.body as { id: string }).id}/download` };
    };

    it('answers a snapshot download with 503 while the dashboard keeps serving', async () => {
      const snapshot = await completedSnapshot();
      outage.isPrivateStorageDown = true;

      const failed = await http().get(snapshot.download).set('Authorization', snapshot.authorization).expect(503);
      const dashboard = await http().get(`/api/v1/events/${snapshot.eventId}/dashboard`).set('Authorization', snapshot.authorization);

      expect(failed.body.message).toBe('Private export storage is temporarily unavailable');
      expect(JSON.stringify(failed.body)).not.toContain('EACCES');
      expect(dashboard.status).toBe(200);
    });

    it('serves the same download again once storage returns', async () => {
      const snapshot = await completedSnapshot();
      outage.isPrivateStorageDown = true;
      await http().get(snapshot.download).set('Authorization', snapshot.authorization).expect(503);

      outage.isPrivateStorageDown = false;
      const recovered = await http().get(snapshot.download).set('Authorization', snapshot.authorization).expect(200);

      expect(recovered.headers['content-type']).toMatch(/text\/csv/);
    });
  });

  describe('rate limits (docs/API.md §1)', () => {
    it('lets a room on one address open the shared invitation', async () => {
      const from = address();

      const statuses = await burst(40, () => http().get('/api/v1/invitations/no-such-slug').set('X-Forwarded-For', from));

      // Every request reached the handler, which found no such invitation.
      expect(new Set(statuses)).toEqual(new Set([404]));
    });

    it("lets a room on one address read each guest's RSVP", async () => {
      const from = address();

      const statuses = await burst(40, () => http().get('/api/v1/invitations/no-such-slug/g/some-token/rsvp').set('X-Forwarded-For', from));

      expect(new Set(statuses)).toEqual(new Set([404]));
    });

    /** Over 100 so that even a burst split across two one-second windows exceeds 50 in one. */
    it('still throttles guest-page reads beyond 50 a second', async () => {
      const from = address();

      const statuses = await burst(110, () => http().get('/api/v1/invitations/no-such-slug/g/some-token').set('X-Forwarded-For', from));

      expect(statuses).toContain(429);
    });

    /** Over 20 so that a burst split across two windows still exceeds 10 in one. */
    it("keeps a guest's RSVP submit on the default 10 a second", async () => {
      const from = address();

      const statuses = await burst(25, () => http().post('/api/v1/invitations/no-such-slug/g/some-token/rsvp').set('X-Forwarded-For', from).send({ status: 'ATTENDING' }));

      expect(statuses).toContain(429);
    });
  });
});
