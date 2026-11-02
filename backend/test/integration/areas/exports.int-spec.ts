import { ConfigService } from '@nestjs/config';
import { ExportKind, PrismaClient } from '@prisma/client';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { FSWatcher, watch } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { AnalyticsService } from '../../../src/infra/analytics/analytics.service';
import { buildPrivateStorage, PrivateStorageService } from '../../../src/infra/storage/private/private-storage';
import { ExportQueue } from '../../../src/modules/exports/export-queue';
import { ExportRunner } from '../../../src/modules/exports/export-runner';
import { ExportSheets } from '../../../src/modules/exports/export-sheets';
import { ExportSnapshotsService } from '../../../src/modules/exports/export-snapshots.service';
import { OperationsService } from '../../../src/modules/operations/operations.service';
import { SeatingService } from '../../../src/modules/seating/seating.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { seedEvent } from '../../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma, TEST_DATABASE_URL } from '../../setup/test-database';

const DAY_MS = 86_400_000;

describe('Exports (integration coverage)', () => {
  let prisma: PrismaClient;
  let root: string;
  let service: ExportSnapshotsService;
  let queue: ExportQueue;
  let runner: ExportRunner;
  let storage: PrivateStorageService;
  let operations: OperationsService;
  beforeAll(() => { prisma = testPrisma(); });
  beforeEach(async () => {
    await resetTestDatabase();
    root = await mkdtemp(join(tmpdir(), 'aveline-exports-coverage-'));
    storage = new PrivateStorageService(buildPrivateStorage(new ConfigService({ S3_ENDPOINT: '', STORAGE_ROOT: join(root, 'public'), PRIVATE_STORAGE_ROOT: join(root, 'private') })));
    const database = prisma as unknown as PrismaService;
    operations = new OperationsService(database, {} as AnalyticsService);
    service = new ExportSnapshotsService(database, storage);
    queue = new ExportQueue(database);
    runner = new ExportRunner(database, queue, storage, operations);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });
  afterAll(() => disconnectTestDatabase());

  const setup = async () => {
    const event = await seedEvent(prisma);
    const user = await prisma.user.create({ data: { name: 'Owner', email: `${randomUUID()}@test.local`, eventMemberships: { create: { eventId: event.eventId, role: 'OWNER' } } } });
    await prisma.guest.updateMany({ where: { eventId: event.eventId }, data: { email: 'primary@test.local' } });
    return { ...event, userId: user.id };
  };
  const queueGuestList = (event: { eventId: string; userId: string }) =>
    service.create(event.eventId, event.userId, { kind: ExportKind.GUEST_LIST, locale: 'en', idempotencyKey: randomUUID() });
  const demoteToViewer = (userId: string) => prisma.eventMembership.updateMany({ where: { userId }, data: { role: 'VIEWER' } });
  const runAllAttempts = async (jobId: string) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await runner.runOne();
      await prisma.exportSnapshot.update({ where: { id: jobId }, data: { nextAttemptAt: new Date(0) } });
    }
  };

  describe('venue seating columns', () => {
    /** Primary seated at two venues, Second at one table, Third attending and unseated. */
    const seatedAtTwoVenues = async () => {
      const event = await seedEvent(prisma);
      const seating = new SeatingService(prisma as unknown as PrismaService);
      const hall = await prisma.venue.findFirstOrThrow({ where: { eventId: event.eventId } });
      const church = await prisma.venue.create({ data: { eventId: event.eventId, role: 'CEREMONY', name: 'Church', address: '2 Test St' } });
      const guest = (firstName: string) => prisma.guest.create({ data: { eventId: event.eventId, householdId: event.householdId,
        firstName, token: randomUUID().replace(/-/g, '').slice(0, 12), rsvp: { create: { status: 'ATTENDING' } } } });
      const [second, third] = [await guest('Second'), await guest('Third')];
      await prisma.rsvp.updateMany({ where: { guest: { eventId: event.eventId } }, data: { status: 'ATTENDING' } });
      const primary = await prisma.guest.findUniqueOrThrow({ where: { token: event.primaryGuestToken } });
      const dinner = await seating.createTable(event.eventId, { name: 'Dinner', capacity: 4, venueId: hall.id });
      const pews = await seating.createTable(event.eventId, { name: 'Church row', capacity: 4, venueId: church.id });
      await seating.assign(event.eventId, { guestId: primary.id, tableId: dinner.id });
      await seating.assign(event.eventId, { guestId: primary.id, tableId: pews.id });
      await seating.assign(event.eventId, { guestId: second.id, tableId: dinner.id });
      return { eventId: event.eventId, dinner, pews, third, sheets: new ExportSheets(prisma, operations) };
    };

    it('leaves the legacy Table empty and lists every venue seat for a guest seated twice', async () => {
      const { eventId, sheets } = await seatedAtTwoVenues();
      const sheet = await sheets.build(eventId, 'GUEST_LIST');
      expect(sheet.columns).toEqual(expect.arrayContaining(['Table', 'Seating by venue']));
      expect(sheet.rows.find((row) => row['First name'] === 'Primary')).toMatchObject({ Table: null, 'Seating by venue': 'Church: Church row; Fixture Hall: Dinner' });
    });

    it('keeps the legacy Table for a guest with a single seat', async () => {
      const { eventId, sheets } = await seatedAtTwoVenues();
      const sheet = await sheets.build(eventId, 'GUEST_LIST');
      expect(sheet.rows.find((row) => row['First name'] === 'Second')).toMatchObject({ Table: 'Dinner', 'Seating by venue': 'Fixture Hall: Dinner' });
    });

    it('names the venue and arrangement of each table in the seating chart', async () => {
      const { eventId, sheets, pews } = await seatedAtTwoVenues();
      const sheet = await sheets.build(eventId, 'SEATING_CHART');
      expect(sheet.columns.slice(0, 2)).toEqual(['Venue', 'Arrangement']);
      expect(sheet.rows.filter((row) => row.Table === 'Church row')).toEqual([
        expect.objectContaining({ Venue: 'Church', Arrangement: pews.arrangementId, Seated: 1, Guest: 'Primary Guest' }),
      ]);
    });

    it('prints one place card per seated arrangement for a guest seated at two venues', async () => {
      const { eventId, sheets, dinner, pews } = await seatedAtTwoVenues();
      const cards = (await sheets.build(eventId, 'PLACE_CARDS')).rows.filter((row) => row.Name === 'Primary Guest');
      expect(cards).toHaveLength(2);
      expect(cards.map((card) => card.Arrangement).sort()).toEqual([dinner.arrangementId, pews.arrangementId].sort());
      expect(cards.map((card) => card.Venue).sort()).toEqual(['Church', 'Fixture Hall']);
    });

    it('prints exactly one blank-seat place card for an attending guest with no seat', async () => {
      const { eventId, sheets } = await seatedAtTwoVenues();
      const cards = (await sheets.build(eventId, 'PLACE_CARDS')).rows.filter((row) => row.Name === 'Third');
      expect(cards).toEqual([{ Name: 'Third', Venue: null, Arrangement: null, Table: null }]);
    });
  });

  describe('snapshot idempotency', () => {
    it('returns the same job for an identical retry', async () => {
      const event = await setup();
      const dto = { kind: ExportKind.GUEST_LIST, locale: 'en', idempotencyKey: randomUUID() };
      const first = await service.create(event.eventId, event.userId, dto);
      expect((await service.create(event.eventId, event.userId, { ...dto })).id).toBe(first.id);
      expect(await prisma.exportSnapshot.count()).toBe(1);
    });

    it.each([
      ['a different locale', { locale: 'fr' }],
      ['a different contact visibility', { includesContacts: false }],
    ])('refuses to reuse a key with %s', async (_change, change) => {
      const event = await setup();
      const dto = { kind: ExportKind.GUEST_LIST, locale: 'en', idempotencyKey: randomUUID() };
      await service.create(event.eventId, event.userId, dto);
      await expect(service.create(event.eventId, event.userId, { ...dto, ...change })).rejects.toThrow('another export');
      expect(await prisma.exportSnapshot.count()).toBe(1);
    });
  });

  describe('retention', () => {
    const original = process.env.EXPORT_RETENTION_DAYS;
    afterEach(() => {
      if (original === undefined) delete process.env.EXPORT_RETENTION_DAYS;
      else process.env.EXPORT_RETENTION_DAYS = original;
    });
    const retentionOfOneRun = async () => {
      const event = await setup();
      const job = await queueGuestList(event);
      await runner.runOne();
      const completed = await prisma.exportSnapshot.findUniqueOrThrow({ where: { id: job.id } });
      expect(completed.status).toBe('COMPLETED');
      return completed.expiresAt!.getTime() - completed.completedAt!.getTime();
    };

    it('expires a published file seven days after completion by default', async () => {
      delete process.env.EXPORT_RETENTION_DAYS;
      expect(Math.abs(await retentionOfOneRun() - 7 * DAY_MS)).toBeLessThan(5000);
    });

    it('expires a published file after the configured EXPORT_RETENTION_DAYS', async () => {
      process.env.EXPORT_RETENTION_DAYS = '2';
      expect(Math.abs(await retentionOfOneRun() - 2 * DAY_MS)).toBeLessThan(5000);
    });
  });

  it('fails a running job whose lease expired on its final attempt as LEASE_EXHAUSTED', async () => {
    const event = await setup();
    const job = await queueGuestList(event);
    await prisma.exportSnapshot.update({ where: { id: job.id }, data: { status: 'RUNNING', attempts: 3, leaseOwner: 'gone', leaseUntil: new Date(0) } });
    expect(await queue.claim()).toBeNull();
    expect(await service.findOne(event.eventId, job.id)).toMatchObject({ status: 'FAILED', failureReason: 'LEASE_EXHAUSTED', downloadPath: null });
  });

  describe('permission changes after queueing', () => {
    it('refuses to capture a contact sheet once the requester lost contact permission', async () => {
      const event = await setup();
      const job = await queueGuestList(event);
      expect(job.includesContacts).toBe(true);
      await demoteToViewer(event.userId);
      await runner.runOne();
      expect(await service.findOne(event.eventId, job.id)).toMatchObject({ status: 'QUEUED', failureReason: 'GENERATION_FAILED', downloadPath: null, snapshotAt: null });
      expect(await prisma.exportArtifact.count()).toBe(0);
    });

    it('refuses to publish a contact sheet when contact permission is lost during the upload', async () => {
      const event = await setup();
      const job = await queueGuestList(event);
      const originalPut = storage.put.bind(storage);
      jest.spyOn(storage, 'put').mockImplementationOnce(async (key, buffer, mimeType) => {
        await originalPut(key, buffer, mimeType);
        await demoteToViewer(event.userId);
      });
      await runner.runOne();
      expect(await service.findOne(event.eventId, job.id)).toMatchObject({ status: 'QUEUED', failureReason: 'GENERATION_FAILED', downloadPath: null });
      expect((await prisma.exportSnapshot.findUniqueOrThrow({ where: { id: job.id } })).artifactKey).toBeNull();
    });
  });

  describe('capture input limits', () => {
    const addVenues = (eventId: string, count: number) => prisma.venue.createMany({ data: Array.from({ length: count }, (_, index) => ({
      eventId, role: 'RECEPTION' as const, name: `Room ${index}`, address: `${index} Test St` })) });

    it('captures an event at the 50-venue limit', async () => {
      const event = await setup();
      await addVenues(event.eventId, 49);
      const job = await queueGuestList(event);
      await runner.runOne();
      expect(await service.findOne(event.eventId, job.id)).toMatchObject({ status: 'COMPLETED' });
    });

    // snapshotAt stays null only when capture itself refused; a render or upload failure happens after it is set.
    it('fails at capture without an artifact when an event has 51 venues', async () => {
      const event = await setup();
      await addVenues(event.eventId, 50);
      const job = await queueGuestList(event);
      await runAllAttempts(job.id);
      expect(await service.findOne(event.eventId, job.id)).toMatchObject({ status: 'FAILED', failureReason: 'GENERATION_FAILED', attempts: 3, downloadPath: null, snapshotAt: null });
      expect(await prisma.exportArtifact.count()).toBe(0);
    });

    const addQuestions = async (eventId: string, count: number) => {
      const invitation = await prisma.invitation.findFirstOrThrow({ where: { eventId } });
      await prisma.rsvpQuestion.createMany({ data: Array.from({ length: count }, (_, index) => ({
        invitationId: invitation.id, type: 'TEXT' as const, sortOrder: index, prompt: { en: `Question ${index}` } })) });
    };

    it('captures an event at the 200-question limit', async () => {
      const event = await setup();
      await addQuestions(event.eventId, 200);
      const job = await queueGuestList(event);
      await runner.runOne();
      expect(await service.findOne(event.eventId, job.id)).toMatchObject({ status: 'COMPLETED' });
    });

    it('fails at capture without an artifact when an event has 201 RSVP questions', async () => {
      const event = await setup();
      await addQuestions(event.eventId, 201);
      const job = await queueGuestList(event);
      await runAllAttempts(job.id);
      expect(await service.findOne(event.eventId, job.id)).toMatchObject({ status: 'FAILED', failureReason: 'GENERATION_FAILED', attempts: 3, snapshotAt: null });
      expect(await prisma.exportArtifact.count()).toBe(0);
    });

    it('fails at capture without an artifact when an event has 5,001 guests', async () => {
      const event = await setup();
      await prisma.guest.createMany({ data: Array.from({ length: 5000 }, (_, index) => ({
        eventId: event.eventId, householdId: event.householdId, firstName: `Guest ${index}`, token: `bulk-${index}-${randomUUID().slice(0, 8)}` })) });
      const job = await queueGuestList(event);
      await runAllAttempts(job.id);
      expect(await service.findOne(event.eventId, job.id)).toMatchObject({ status: 'FAILED', failureReason: 'GENERATION_FAILED', attempts: 3, snapshotAt: null });
      expect(await prisma.exportArtifact.count()).toBe(0);
    });
  });

  describe('worker health', () => {
    // Runs even when a test times out, so no worker process or watcher outlives its test.
    const teardown: (() => void)[] = [];
    afterEach(() => { teardown.splice(0).forEach((stop) => stop()); });
    const check = (heartbeatPath: string) => new Promise<number | null>((resolve, reject) => {
      const child = spawn(process.execPath, ['scripts/check-export-worker.mjs'], {
        cwd: process.cwd(), stdio: 'ignore', env: { ...process.env, EXPORT_WORKER_HEARTBEAT_PATH: heartbeatPath },
      });
      child.once('error', reject); child.once('exit', resolve);
    });
    const heartbeat = async (content: string) => {
      const path = join(root, `heartbeat-${randomUUID()}`);
      await writeFile(path, content);
      return path;
    };

    it('is healthy with a fresh heartbeat', async () => {
      expect(await check(await heartbeat(String(Date.now())))).toBe(0);
    });
    it('is unhealthy when the heartbeat is older than 120 seconds', async () => {
      expect(await check(await heartbeat(String(Date.now() - 121_000)))).toBe(1);
    });
    it('is unhealthy when no heartbeat was ever written', async () => {
      expect(await check(join(root, 'missing'))).toBe(1);
    });
    it('is unhealthy when the heartbeat is not a timestamp', async () => {
      expect(await check(await heartbeat('not-a-number'))).toBe(1);
    });

    it('writes a fresh heartbeat after a worker loop and stops cleanly on SIGTERM', async () => {
      const path = join(root, 'worker-heartbeat');
      const heartbeatFile = whenWritten(path);
      const child = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', 'src/export-worker.ts'], {
        cwd: process.cwd(), stdio: 'ignore', env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: TEST_DATABASE_URL,
          TS_NODE_PROJECT: 'tsconfig.build.json', S3_ENDPOINT: '', ANALYTICS_ENABLED: 'false', STORAGE_ROOT: join(root, 'public'),
          PRIVATE_STORAGE_ROOT: join(root, 'private'), EXPORT_WORKER_HEARTBEAT_PATH: path },
      });
      teardown.push(() => { heartbeatFile.close(); child.kill('SIGKILL'); });
      const exited = new Promise<number | null>((resolve) => { child.once('exit', resolve); });
      const written = await heartbeatFile.content;
      expect(Number(written)).toBeGreaterThan(Date.now() - 30_000);
      expect(await check(path)).toBe(0);
      child.kill('SIGTERM');
      expect(await exited).toBe(0);
    });
  });
});

/** Resolves with a file's first non-empty content, driven by directory events rather than polling. */
function whenWritten(path: string): { content: Promise<string>; close: () => void } {
  let watcher: FSWatcher | undefined;
  const content = new Promise<string>((resolve) => {
    watcher = watch(dirname(path), () => {
      void readFile(path, 'utf8').then((text) => { if (text) { watcher?.close(); resolve(text); } }, () => undefined);
    });
  });
  return { content, close: () => watcher?.close() };
}
