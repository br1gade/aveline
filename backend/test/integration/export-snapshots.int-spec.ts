import { AttendancePolicyService } from '../../src/modules/events/attendance-policy.service';
import { CacheService } from '../../src/infra/cache/cache.service';
import { PrismaClient, ExportKind, ExportFormat } from '@prisma/client';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma, TEST_DATABASE_URL } from '../setup/test-database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { OperationsService } from '../../src/modules/operations/operations.service';
import { AnalyticsService } from '../../src/infra/analytics/analytics.service';
import { buildPrivateStorage, PrivateStorageService } from '../../src/infra/storage/private/private-storage';
import { ExportSnapshotsService } from '../../src/modules/exports/export-snapshots.service';
import { ExportQueue } from '../../src/modules/exports/export-queue';
import { ExportRunner } from '../../src/modules/exports/export-runner';
import { lockExportPrivacy, rememberExportSubjects } from '../../src/modules/exports/export-privacy';
import { eraseSubject } from '../../src/modules/privacy/erasure';

describe('Fixed export snapshots (integration)', () => {
  let prisma: PrismaClient;
  let root: string;
  let service: ExportSnapshotsService;
  let queue: ExportQueue;
  let runner: ExportRunner;
  let storage: PrivateStorageService;
  beforeAll(() => { prisma = testPrisma(); });
  beforeEach(async () => {
    await resetTestDatabase();
    root = await mkdtemp(join(tmpdir(), 'aveline-snapshots-'));
    storage = new PrivateStorageService(buildPrivateStorage(new ConfigService({ S3_ENDPOINT: '', STORAGE_ROOT: join(root, 'public'), PRIVATE_STORAGE_ROOT: join(root, 'private') })));
    const database = prisma as unknown as PrismaService;
    const operations = new OperationsService(database, {} as AnalyticsService);
    service = new ExportSnapshotsService(database, storage);
    queue = new ExportQueue(database);
    runner = new ExportRunner(database, queue, storage, operations);
  });
  afterEach(() => rm(root, { recursive: true, force: true }));
  afterAll(() => disconnectTestDatabase());
  const setup = async () => {
    const event = await seedEvent(prisma);
    const user = await prisma.user.create({ data: { name: 'Owner', email: `${randomUUID()}@test.local`, eventMemberships: { create: { eventId: event.eventId, role: 'OWNER' } } } });
    await prisma.guest.updateMany({ where: { eventId: event.eventId }, data: { email: 'primary@test.local' } });
    return { ...event, userId: user.id };
  };
  const request = (event: { eventId: string; userId: string }, kind: ExportKind = 'GUEST_LIST', format: ExportFormat = 'CSV') => service.create(event.eventId, event.userId, { kind, format, locale: 'en', idempotencyKey: randomUUID() });

  const matrix = Object.values(ExportKind).flatMap((kind) => Object.values(ExportFormat).map((format) => ({ kind, format })));
  it.each(matrix)('publishes one immutable private $kind $format snapshot', async ({ kind, format }) => {
    const event = await setup();
    const job = await request(event, kind, format);
    expect(job).toMatchObject({ format, status: 'QUEUED', includesContacts: true, locale: 'en', downloadPath: null });
    await runner.runOne();
    const completed = await service.findOne(event.eventId, job.id);
    expect(completed).toMatchObject({ status: 'COMPLETED', snapshotAt: expect.any(Date), timezone: 'Asia/Yerevan', attendanceRevision: 1 });
    const before = await service.download(event.eventId, job.id, event.userId);
    expect(before.filename.endsWith(`.${format.toLowerCase()}`)).toBe(true);
    const magic = { CSV: Buffer.from('\uFEFF'), PDF: Buffer.from('%PDF-'), XLSX: Buffer.from('PK') }[format];
    expect(before.buffer.subarray(0, magic.length).equals(magic)).toBe(true);
    await prisma.guest.updateMany({ where: { eventId: event.eventId }, data: { firstName: 'Changed' } });
    expect((await service.download(event.eventId, job.id, event.userId)).buffer.equals(before.buffer)).toBe(true);
    expect(JSON.stringify(completed)).not.toMatch(/artifactKey|http:\/\//);
    expect(await prisma.mediaAsset.count()).toBe(0);
  });

  it.each(['EVENT_WIDE', 'PER_VENUE'] as const)('exports independent venue covers and drinks in %s mode', async (mode) => {
    const event = await setup();
    const hall = await prisma.venue.findFirstOrThrow({ where: { eventId: event.eventId } });
    const garden = await prisma.venue.create({ data: { eventId: event.eventId, name: 'Garden', address: '2 Test St', role: 'RECEPTION' } });
    await prisma.venue.create({ data: { eventId: event.eventId, name: 'Private preparation', address: 'Secret', role: 'PREPARATION' } });
    if (mode === 'PER_VENUE') {
      const policies = new AttendancePolicyService(prisma as unknown as PrismaService, { invalidateInvitation: jest.fn().mockResolvedValue(undefined) } as unknown as CacheService);
      const preview = await policies.preview(event.eventId, mode);
      await policies.change(event.eventId, { ...preview.request, transitionId: randomUUID() });
    }
    const guest = await prisma.guest.findFirstOrThrow({ where: { eventId: event.eventId } });
    await prisma.rsvp.update({ where: { guestId: guest.id }, data: { status: 'ATTENDING', dietary: ['vegan'], dietaryNotes: 'No nuts', drinkPreference: 'water' } });
    if (mode === 'PER_VENUE') {
      await prisma.attendanceResponse.createMany({ data: [
        { eventId: event.eventId, guestId: guest.id, revision: 2, scopeId: hall.id, venueId: hall.id, status: 'ATTENDING' },
        { eventId: event.eventId, guestId: guest.id, revision: 2, scopeId: garden.id, venueId: garden.id, status: 'DECLINED' },
      ] });
    }
    const catering = await request(event, 'CATERING_SHEET');
    const bar = await request(event, 'BAR_SHEET');
    await runner.runOne(); await runner.runOne();
    const covers = (await service.download(event.eventId, catering.id, event.userId)).buffer.toString();
    const drinks = (await service.download(event.eventId, bar.id, event.userId)).buffer.toString();
    expect(covers).toContain('"Venue"');
    expect(covers).toContain(`"Garden","Total covers","${mode === 'PER_VENUE' ? 0 : 1}"`);
    expect(covers).not.toContain('Private preparation');
    expect(drinks).toContain('"Fixture Hall","water","1","100"');
    expect(drinks).not.toContain('Private preparation');
  });

  it('deduplicates one intent and rejects reuse with a different kind or visibility', async () => {
    const event = await setup();
    const dto = { kind: ExportKind.GUEST_LIST, idempotencyKey: randomUUID() };
    const jobs = await Promise.all([service.create(event.eventId, event.userId, dto), service.create(event.eventId, event.userId, dto)]);
    expect(jobs[0].id).toBe(jobs[1].id);
    await expect(service.create(event.eventId, event.userId, { ...dto, kind: 'PLAYLIST' })).rejects.toThrow('another export');
    await expect(service.create(event.eventId, event.userId, { ...dto, format: 'PDF' })).rejects.toThrow('another export');
  });

  it('refuses incomplete, cross-event, reduced-role and inactive-user downloads', async () => {
    const event = await setup();
    const job = await request(event);
    await expect(service.download(event.eventId, job.id, event.userId)).rejects.toThrow('ready');
    await runner.runOne();
    await expect(service.download('another-event', job.id, event.userId)).rejects.toThrow('No such');
    await prisma.eventMembership.updateMany({ where: { userId: event.userId }, data: { role: 'VIEWER' } });
    await expect(service.download(event.eventId, job.id, event.userId)).rejects.toThrow('contact');
    const redacted = await request(event);
    await runner.runOne();
    expect((await service.download(event.eventId, redacted.id, event.userId)).buffer.toString()).not.toContain('primary@test.local');
    await expect(request(event, 'TICKET_MANIFEST')).rejects.toThrow('contact');
    await prisma.user.update({ where: { id: event.userId }, data: { isActive: false } });
    await expect(service.download(event.eventId, redacted.id, event.userId)).rejects.toThrow('permission');
  });

  it('claims once, recovers an expired lease and rejects the stale owner', async () => {
    const event = await setup();
    const job = await request(event);
    const claims = await Promise.all([queue.claim(), queue.claim()]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const first = claims.find(Boolean)!;
    await prisma.exportSnapshot.update({ where: { id: job.id }, data: { leaseUntil: new Date(0) } });
    const recovered = await queue.claim();
    expect(recovered).toMatchObject({ id: job.id, attempts: 2 });
    expect(await queue.renew(first)).toBe(false);
    expect(await queue.fail(first, 'STALE')).toBe(false);
    await runner.process(recovered!);
    expect(await service.findOne(event.eventId, job.id)).toMatchObject({ status: 'COMPLETED', attempts: 2 });
  });

  it('revokes completed and running artifacts on erasure, including a changed original email', async () => {
    const event = await setup();
    const job = await request(event);
    await runner.runOne();
    const stored = await prisma.exportSnapshot.findUniqueOrThrow({ where: { id: job.id } });
    await prisma.guest.updateMany({ where: { eventId: event.eventId }, data: { email: 'changed@test.local' } });
    await prisma.$transaction((tx) => eraseSubject(tx, 'primary@test.local', new Date()));
    await expect(service.download(event.eventId, job.id, event.userId)).rejects.toThrow('revoked');
    await runner.cleanup();
    await expect(storage.get(stored.artifactKey!)).rejects.toThrow();
    expect(await prisma.exportSnapshotSubject.count()).toBe(0);
  });

  it('never publishes after erasure wins during an upload', async () => {
    const event = await setup();
    const job = await request(event);
    const originalPut = storage.put.bind(storage);
    jest.spyOn(storage, 'put').mockImplementation(async (key, buffer, mimeType) => {
      await originalPut(key, buffer, mimeType);
      await prisma.$transaction((tx) => eraseSubject(tx, 'primary@test.local', new Date()));
    });
    await runner.runOne();
    expect(await service.findOne(event.eventId, job.id)).toMatchObject({ status: 'FAILED', failureReason: 'SUBJECT_ERASED' });
    await runner.cleanup();
  });

  it('retains cleanup records after event deletion and expires files without deleting the source event', async () => {
    const event = await setup();
    const job = await request(event);
    await runner.runOne();
    const record = await prisma.exportSnapshot.findUniqueOrThrow({ where: { id: job.id } });
    await prisma.exportSnapshot.update({ where: { id: job.id }, data: { expiresAt: new Date(0) } });
    await expect(service.download(event.eventId, job.id, event.userId)).rejects.toThrow('expired');
    await prisma.event.delete({ where: { id: event.eventId } });
    expect(await prisma.exportArtifact.count()).toBe(1);
    await runner.cleanup();
    await expect(storage.get(record.artifactKey!)).rejects.toThrow();
  });

  it('bounds retries and keeps storage failures private', async () => {
    const event = await setup();
    const job = await request(event);
    jest.spyOn(storage, 'put').mockRejectedValue(new Error('secret endpoint/password'));
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await runner.runOne();
      await prisma.exportSnapshot.update({ where: { id: job.id }, data: { nextAttemptAt: new Date(0) } });
    }
    expect(await service.findOne(event.eventId, job.id)).toMatchObject({ status: 'FAILED', attempts: 3, failureReason: 'GENERATION_FAILED' });
    expect(await queue.claim()).toBeNull();
  });

  it('cannot replace the winner when an expired worker resumes after a recovered upload', async () => {
    const event = await setup();
    const job = await request(event);
    const originalPut = storage.put.bind(storage);
    let staleKey = '';
    jest.spyOn(storage, 'put').mockImplementationOnce(async (key, buffer, mimeType) => {
      staleKey = key;
      await originalPut(key, buffer, mimeType);
      await prisma.exportSnapshot.update({ where: { id: job.id }, data: { leaseUntil: new Date(0) } });
      const recovered = await queue.claim();
      await runner.process(recovered!);
    });
    await runner.runOne();
    const winner = await prisma.exportSnapshot.findUniqueOrThrow({ where: { id: job.id } });
    expect(winner).toMatchObject({ status: 'COMPLETED', attempts: 2 });
    expect(winner.artifactKey).not.toBe(staleKey);
    await prisma.exportArtifact.update({ where: { key: staleKey }, data: { cleanupAfter: new Date(0) } });
    await runner.cleanup();
    await expect(storage.get(staleKey)).rejects.toThrow();
    expect((await service.download(event.eventId, job.id, event.userId)).buffer.length).toBeGreaterThan(0);
  });

  it('rechecks permissions after private storage returns bytes', async () => {
    const event = await setup();
    const job = await request(event);
    await runner.runOne();
    const originalGet = storage.get.bind(storage);
    jest.spyOn(storage, 'get').mockImplementationOnce(async (key) => {
      const bytes = await originalGet(key);
      await prisma.eventMembership.deleteMany({ where: { userId: event.userId } });
      return bytes;
    });
    await expect(service.download(event.eventId, job.id, event.userId)).rejects.toThrow('permission');
  });

  it('retains failed cleanup work until private storage recovers', async () => {
    const event = await setup();
    const job = await request(event);
    await runner.runOne();
    const artifact = await prisma.exportArtifact.findFirstOrThrow();
    await prisma.event.delete({ where: { id: event.eventId } });
    const remove = jest.spyOn(storage, 'remove').mockRejectedValueOnce(new Error('offline'));
    await runner.cleanup();
    expect(await prisma.exportArtifact.findUnique({ where: { key: artifact.key } })).toMatchObject({ deletedAt: null, isRetired: true });
    remove.mockRestore();
    await runner.cleanup();
    await expect(storage.get(artifact.key)).rejects.toThrow();
    expect(await prisma.exportSnapshot.count({ where: { id: job.id } })).toBe(0);
  });

  it('bounds pending work per event while preserving idempotent retries', async () => {
    const event = await setup();
    for (let index = 0; index < 10; index += 1) await request(event);
    await expect(request(event)).rejects.toThrow('10 active exports');
    expect(await prisma.exportSnapshot.count()).toBe(10);
  });


  it('fences erasure until an older consistent capture registers its original subject', async () => {
    const event = await setup();
    const job = await request(event);
    await prisma.exportPrivacyFence.create({ data: { id: 'exports' } });
    let captured = () => undefined as void;
    let release = () => undefined as void;
    const didCapture = new Promise<void>((resolve) => { captured = resolve; });
    const canFinish = new Promise<void>((resolve) => { release = resolve; });
    const capture = prisma.$transaction(async (tx) => {
      await lockExportPrivacy(tx);
      captured();
      await canFinish;
      await rememberExportSubjects(tx, { id: job.id, eventId: event.eventId });
    }, { isolationLevel: 'RepeatableRead' });
    await didCapture;
    await prisma.guest.updateMany({ where: { eventId: event.eventId }, data: { email: 'changed@test.local' } });
    let didErase = false;
    const erasure = prisma.$transaction(async (tx) => { await eraseSubject(tx, 'primary@test.local', new Date()); didErase = true; });
    try {
      await delay(40);
      expect(didErase).toBe(false);
    } finally { release(); }
    await capture;
    await erasure;
    expect(await service.findOne(event.eventId, job.id)).toMatchObject({ status: 'FAILED', failureReason: 'SUBJECT_ERASED' });
  });

  it('recovers a terminated real worker and shuts its replacement down gracefully', async () => {
    const event = await setup();
    const job = await request(event);
    await prisma.exportPrivacyFence.create({ data: { id: 'exports' } });
    let release = () => undefined as void;
    let locked = () => undefined as void;
    const isLocked = new Promise<void>((resolve) => { locked = resolve; });
    const canRelease = new Promise<void>((resolve) => { release = resolve; });
    const fence = prisma.$transaction(async (tx) => {
      await tx.exportPrivacyFence.update({ where: { id: 'exports' }, data: { revision: { increment: 1 } } });
      locked();
      await canRelease;
    }, { timeout: 25_000 });
    await isLocked;
    const startWorker = () => {
      const child = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', 'src/export-worker.ts'], {
        cwd: process.cwd(), stdio: 'ignore', env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: TEST_DATABASE_URL,
          TS_NODE_PROJECT: 'tsconfig.build.json', S3_ENDPOINT: '', ANALYTICS_ENABLED: 'false', STORAGE_ROOT: join(root, 'public'), PRIVATE_STORAGE_ROOT: join(root, 'private'),
          EXPORT_WORKER_HEARTBEAT_PATH: join(root, 'heartbeat') },
      });
      const exited = new Promise<number | null>((resolve) => { child.once('exit', resolve); });
      return { child, exited };
    };
    const first = startWorker();
    let replacement: ReturnType<typeof startWorker> | undefined;
    try {
      await waitForState(prisma, job.id, 'RUNNING');
      first.child.kill('SIGKILL');
      await first.exited;
      release();
      await fence;
      await prisma.exportSnapshot.update({ where: { id: job.id }, data: { leaseUntil: new Date(0) } });
      replacement = startWorker();
      await waitForState(prisma, job.id, 'COMPLETED');
      replacement.child.kill('SIGTERM');
      expect(await replacement.exited).toBe(0);
      expect(await service.findOne(event.eventId, job.id)).toMatchObject({ status: 'COMPLETED', attempts: 2 });
    } finally {
      release();
      await fence;
      first.child.kill('SIGKILL');
      replacement?.child.kill('SIGKILL');
    }
  });

});


async function waitForState(prisma: PrismaClient, id: string, status: string): Promise<void> {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const job = await prisma.exportSnapshot.findUniqueOrThrow({ where: { id } });
    if (job.status === status) return;
    await delay(50);
  }
  throw new Error(`Worker did not reach ${status}`);
}
