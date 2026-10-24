import { SerializeInterceptor } from '../../src/common/interceptors/serialize';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ExportRunner } from '../../src/modules/exports/export-runner';
import { buildPrivateStorage, PRIVATE_STORAGE } from '../../src/infra/storage/private/private-storage';
import { ConfigService } from '@nestjs/config';
import { authenticateAs } from '../fixtures/auth.fixture';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

describe('Snapshot contract (HTTP)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let root: string;
  beforeAll(async () => {
    prisma = testPrisma();
    root = await mkdtemp(join(tmpdir(), 'aveline-snapshot-http-'));
    const storage = buildPrivateStorage(new ConfigService({ S3_ENDPOINT: '', STORAGE_ROOT: join(root, 'public'), PRIVATE_STORAGE_ROOT: join(root, 'private') }));
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(prisma).overrideProvider(PRIVATE_STORAGE).useValue(storage).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalInterceptors(new SerializeInterceptor());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  beforeEach(() => resetTestDatabase());
  afterAll(async () => { await app.close(); await rm(root, { recursive: true, force: true }); await disconnectTestDatabase(); });
  const http = () => request(app.getHttpServer() as Server);
  const setup = async () => {
    const event = await seedEvent(prisma);
    const actor = await authenticateAs(app, prisma, { eventId: event.eventId, role: 'OWNER' });
    return { ...event, ...actor, base: `/api/v1/events/${event.eventId}/export-snapshots` };
  };
  it.each(['CSV', 'PDF', 'XLSX'] as const)('returns queued %s metadata, then authenticated bytes with the correct MIME type', async (format) => {
    const event = await setup();
    const response = await http().post(event.base).set('Authorization', event.authorization).send({ kind: 'GUEST_LIST', format, locale: 'en', idempotencyKey: randomUUID() }).expect(201);
    const id = (response.body as { id: string }).id;
    expect(response.body).toMatchObject({ status: 'QUEUED', downloadPath: null, includesContacts: true });
    await http().get(`${event.base}/${id}/download`).set('Authorization', event.authorization).expect(409);
    await app.get(ExportRunner).runOne();
    await http().get(`${event.base}/${id}`).set('Authorization', event.authorization).expect(200).expect(({ body }: { body: { status: string } }) => { expect(body.status).toBe('COMPLETED'); });
    const file = await http().get(`${event.base}/${id}/download`).set('Authorization', event.authorization).buffer(true).parse((response, done) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => done(null, Buffer.concat(chunks)));
      response.on('error', done);
    }).expect(200).expect('Cache-Control', 'no-store').expect('Content-Type', ({ CSV: /text\/csv/, PDF: /application\/pdf/, XLSX: /spreadsheetml/ })[format]);
    const bytes = file.body as Buffer;
    expect(Buffer.isBuffer(bytes)).toBe(true);
    const prefix = { CSV: Buffer.from([0xef, 0xbb, 0xbf]), PDF: Buffer.from('%PDF-'), XLSX: Buffer.from('PK') }[format];
    expect(bytes.subarray(0, prefix.length)).toEqual(prefix);
    expect(file.headers['content-disposition']).toContain(`.${format.toLowerCase()}`);
    expect(file.headers['content-length']).toBeDefined();
    await http().get(`${event.base}/${id}/download`).expect(401);
    const other = await seedEvent(prisma);
    await http().get(`/api/v1/events/${other.eventId}/export-snapshots/${id}`).set('Authorization', event.authorization).expect(403);
  });
  it.each([
    { kind: 'GUEST_LIST', idempotencyKey: 'not-a-uuid' },
    { kind: 'GUEST_LIST', idempotencyKey: randomUUID(), locale: 'zz' },
    { kind: 'GUEST_LIST', idempotencyKey: randomUUID(), includesContacts: 'false' },
    { kind: 'UNKNOWN', idempotencyKey: randomUUID() },
    { kind: 'GUEST_LIST', idempotencyKey: randomUUID(), format: 'DOCX' },
  ])('rejects unsupported or malformed requests atomically: %j', async (dto) => {
    const event = await setup();
    await http().post(event.base).set('Authorization', event.authorization).send(dto).expect(400);
    expect(await prisma.exportSnapshot.count()).toBe(0);
  });
  it('does not allow invitation designers into the operational export queue', async () => {
    const event = await seedEvent(prisma);
    const actor = await authenticateAs(app, prisma, { eventId: event.eventId, role: 'DESIGNER' });
    await http().post(`/api/v1/events/${event.eventId}/export-snapshots`).set('Authorization', actor.authorization).send({ kind: 'GUEST_LIST', idempotencyKey: randomUUID() }).expect(403);
  });
});
