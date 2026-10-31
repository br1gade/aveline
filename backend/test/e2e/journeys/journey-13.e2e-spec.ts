import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { BlockType, MessageChannel, MessageStatus, PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import sharp from 'sharp';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { SerializeInterceptor } from '../../../src/common/interceptors/serialize';
import { REDIS_CLIENT } from '../../../src/infra/cache/cache.service';
import { buildPrivateStorage, PRIVATE_STORAGE, PrivateStorage, PrivateStorageService } from '../../../src/infra/storage/private/private-storage';
import { MessageTransport } from '../../../src/modules/communications/channels/message-channel';
import { SmtpTransport } from '../../../src/modules/communications/channels/smtp.transport';
import { MESSAGE_TRANSPORTS } from '../../../src/modules/communications/communications.module';
import { CommunicationsService } from '../../../src/modules/communications/communications.service';
import { ExportQueue } from '../../../src/modules/exports/export-queue';
import { ExportRunner } from '../../../src/modules/exports/export-runner';
import { PrivateMediaRunner } from '../../../src/modules/guest-contributions/private-media-runner';
import { OperationsService } from '../../../src/modules/operations/operations.service';
import { SeatingPlanner } from '../../../src/modules/seating/jobs/seating-planner';
import { SeatingQueue } from '../../../src/modules/seating/jobs/seating-queue';
import { SeatingRunner } from '../../../src/modules/seating/jobs/seating-runner';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { MESSAGE_COPY } from '../../../src/seed/message-copy';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { InterruptibleLink, stall } from '../../fixtures/coverage/journey-13.fixture';
import { disconnectTestDatabase, resetTestDatabase, TEST_DATABASE_URL, testPrisma } from '../../setup/test-database';

const DAY_MS = 24 * 60 * 60 * 1000;
/** The app's Postgres pool is kept this small so "how many requests until it heals" has a fixed bound. */
const POOL_SIZE = 3;

/** Reads an exported CSV the way a spreadsheet would: BOM stripped, CRLF rows, quoted cells. */
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.length > 0);
  const [header, ...rows] = lines.map(parseCsvLine);
  return rows.map((cells) => Object.fromEntries(header.map((name, index) => [name, cells[index] ?? ''])));
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  const pattern = /"((?:[^"]|"")*)"|([^,]*)/g;
  let position = 0;
  while (position <= line.length) {
    pattern.lastIndex = position;
    const match = pattern.exec(line)!;
    cells.push(match[1] !== undefined ? match[1].replace(/""/g, '"') : match[2]);
    position = pattern.lastIndex + 1;
  }
  return cells;
}

const photo = () => sharp({ create: { width: 120, height: 80, channels: 3, background: '#b8860b' } }).jpeg().toBuffer();

interface Household { household: string; status: string; attempts: number; toAddress?: string }
interface TableView { name: string; guests: { name: string }[] }
interface GalleryItem { id: string; processingStatus: string; moderationStatus: string; failureReason: string | null }

/**
 * Journey 13: recovery and operations.
 *
 * The pilot rehearsal (scripts/pilot/recovery.mjs, worker-recovery.mjs,
 * mail-recovery.mjs) stops containers by hand. Here the same chain runs
 * in-process through the real AppModule: Postgres, Redis and SMTP sit behind
 * a TCP link the test cuts and restores mid-flow, and the export, seating
 * and private-media workers are "killed" by stalling one runner inside its
 * job, so the lease it holds must expire before a replacement runner — the
 * one the worker processes use — takes the job as attempt 2. The stalled
 * runner is then let go, the way a paused process wakes, and must change
 * nothing. Lease expiry is moved in the database; no test waits on a clock.
 */
describe('Journey 13: recovery from dependency outages and dead workers (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let appPrisma: PrismaClient;
  let redis: Redis;
  let smtp: SmtpTransport;
  let root: string;
  const postgresLink = new InterruptibleLink({ host: '127.0.0.1', port: Number(new URL(TEST_DATABASE_URL).port || 5432) });
  const redisLink = new InterruptibleLink({ host: '127.0.0.1', port: Number(new URL(process.env.REDIS_URL ?? 'redis://localhost:6380').port) });
  const smtpLink = new InterruptibleLink({ host: '127.0.0.1', port: Number(process.env.SMTP_PORT ?? 1025) });

  const http = () => request(app.getHttpServer() as Server);
  const api = (path: string) => `/api/v1${path}`;
  const privateRoot = () => join(root, 'private');
  const database = () => appPrisma as unknown as PrismaService;

  const appDatabaseUrl = () => {
    const url = new URL(TEST_DATABASE_URL);
    url.hostname = '127.0.0.1';
    url.port = String(postgresLink.port);
    url.searchParams.set('connection_limit', String(POOL_SIZE));
    url.searchParams.set('connect_timeout', '2');
    url.searchParams.set('pool_timeout', '2');
    return url.toString();
  };

  beforeAll(async () => {
    prisma = testPrisma();
    root = await mkdtemp(join(tmpdir(), 'aveline-journey-13-'));
    await Promise.all([postgresLink.start(), redisLink.start(), smtpLink.start()]);
    appPrisma = new PrismaClient({ datasources: { db: { url: appDatabaseUrl() } } });
    // The production client's options (cache.module.ts), reconnecting quickly so recovery needs no waiting.
    redis = new Redis(`redis://127.0.0.1:${redisLink.port}`, { maxRetriesPerRequest: 1, enableOfflineQueue: false, retryStrategy: () => 25 });
    redis.on('error', () => undefined);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(appPrisma)
      .overrideProvider(REDIS_CLIENT).useValue(redis)
      .overrideProvider(PRIVATE_STORAGE)
      .useValue(buildPrivateStorage(new ConfigService({ S3_ENDPOINT: '', STORAGE_ROOT: join(root, 'public'), PRIVATE_STORAGE_ROOT: privateRoot() })))
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalInterceptors(new SerializeInterceptor());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    // Every worker step is driven in-process; a cron firing mid-journey would race the counts.
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) await job.stop();
    // Real SMTP to the local mail sink, through the link the test can cut.
    const transports = app.get<Map<MessageChannel, MessageTransport>>(MESSAGE_TRANSPORTS);
    const configured = transports.get(MessageChannel.EMAIL);
    if (configured instanceof SmtpTransport) configured.close();
    smtp = new SmtpTransport({ host: '127.0.0.1', port: smtpLink.port, isSecure: false, from: 'pilot@aveline.test' });
    transports.set(MessageChannel.EMAIL, smtp);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    await prisma.designTemplate.create({
      data: { key: 'journey-13', name: 'Journey 13', allowedFonts: ['Inter'], supportedBlocks: [BlockType.HERO, BlockType.VENUE, BlockType.RSVP] },
    });
    await prisma.messageTemplate.createMany({ data: MESSAGE_COPY.map((template) => ({ ...template, organizationId: null })) });
  });

  afterAll(async () => {
    smtp?.close();
    await app?.close();
    await appPrisma?.$disconnect();
    await Promise.all([postgresLink.stop(), redisLink.stop(), smtpLink.stop()]);
    await rm(root, { recursive: true, force: true });
    await disconnectTestDatabase();
  });

  const callerFor = (authorization: string) => ({
    get: (path: string) => http().get(api(path)).set('Authorization', authorization),
    post: (path: string, body: object = {}) => http().post(api(path)).set('Authorization', authorization).send(body),
    patch: (path: string, body: object) => http().patch(api(path)).set('Authorization', authorization).send(body),
  });

  /** A published wedding with one room, one table and two invited households, built over HTTP. */
  const publishedWedding = async () => {
    const { authorization } = await authenticateAs(app, prisma);
    const host = callerFor(authorization);
    await host.post('/organizations', { name: 'Recovery Weddings' }).expect(201);
    const { body: event } = await host.post('/events', {
      type: 'WEDDING', title: 'Ani & Narek', templateKey: 'journey-13', startsAt: new Date(Date.now() + 30 * DAY_MS).toISOString(),
      timezone: 'Asia/Yerevan', locales: ['en'], defaultLocale: 'en',
    }).expect(201);
    const slug = event.invitation.slug as string;
    const base = `/events/${event.id as string}`;
    const { body: venue } = await host.post(`${base}/venues`, { role: 'RECEPTION', name: 'Ararat Hall', address: '1 Abovyan St, Yerevan', capacity: 120 }).expect(201);
    await host.post(`${base}/tables`, { name: 'Table 1', capacity: 6, venueId: venue.id }).expect(201);
    await host.patch(`/invitations/${slug}/blocks/HERO`, { content: { en: { title: 'Ani & Narek are getting married' } } }).expect(200);
    const invite = async (firstName: string, lastName: string) => {
      const email = `${firstName.toLowerCase()}@journey13.test`;
      const { body } = await host.post(`${base}/guests`, { firstName, lastName, email, seatsAllotted: 1 }).expect(201);
      return { id: body.id as string, email, link: `/invitations/${slug}/g/${body.token as string}` };
    };
    const lusine = await invite('Lusine', 'Sargsyan');
    const armen = await invite('Armen', 'Petrosyan');
    await host.post(`/invitations/${slug}/publish`).expect(201);
    return { host, eventId: event.id as string, slug, base, venueId: venue.id as string, lusine, armen };
  };
  type Wedding = Awaited<ReturnType<typeof publishedWedding>>;

  const readiness = () => http().get(api('/health/ready'));
  const heroTitle = async (link: string) => {
    const { body } = await http().get(api(link)).expect(200);
    return (body.blocks as { type: string; content: { title?: string } }[]).find((block) => block.type === 'HERO')?.content.title;
  };
  const headcount = async (wedding: Wedding) => (await wedding.host.get(`${wedding.base}/dashboard`).expect(200)).body.headcount as Record<string, number>;
  const deliveryOf = async (wedding: Wedding) =>
    ((await wedding.host.get(`/invitations/${wedding.slug}/delivery`).expect(200)).body.households as Household[])
      .map(({ household, status, attempts }) => ({ household, status, attempts })).sort((a, b) => a.household.localeCompare(b.household));
  const rsvpStatusOf = async (guestId: string) => (await prisma.rsvp.findUnique({ where: { guestId } }))?.status ?? 'PENDING';

  /** Reconnecting is ioredis's job; the test only waits for the event that says it happened. */
  const redisIsBack = async () => {
    await redisLink.start();
    if (redis.status !== 'ready') await once(redis, 'ready');
  };

  /**
   * After a Postgres restart each pooled connection is found dead on its next
   * use, so a bounded number of requests fail before the pool is fresh. More
   * than one per pooled connection would mean the API needs a restart.
   */
  const postgresIsBack = async () => {
    await postgresLink.start();
    const statuses: number[] = [];
    for (let probe = 0; probe <= 20 && statuses.at(-1) !== 200; probe += 1) { const r = await readiness(); console.log(Date.now(), r.status, JSON.stringify(r.body.message?.required)); statuses.push(r.status); }
    expect(statuses.at(-1)).toBe(200);
    expect(statuses.slice(0, -1).every((status) => status === 503)).toBe(true);
  };

  /** Step 1: the host sends while the mail server is unreachable, then it comes back. */
  const sendsThroughAnSmtpOutage = async (wedding: Wedding) => {
    await smtpLink.stop();
    expect((await wedding.host.post(`/invitations/${wedding.slug}/send`).expect(201)).body.queued).toBe(2);
    await app.get(CommunicationsService).dispatchDue();
    const retained = await prisma.message.findMany({ where: { eventId: wedding.eventId, templateKey: 'invitation.send' } });
    expect(retained).toHaveLength(2);
    for (const message of retained) {
      expect(message).toMatchObject({ status: MessageStatus.QUEUED, attempts: 1, sentAt: null });
      expect(message.scheduledFor.getTime()).toBeGreaterThan(Date.now());
    }
    // "QUEUED with attempts above zero is a message being retried" (API.md), not lost, not failed.
    expect(await deliveryOf(wedding)).toEqual([
      { household: 'Armen Petrosyan', status: 'QUEUED', attempts: 1 },
      { household: 'Lusine Sargsyan', status: 'QUEUED', attempts: 1 },
    ]);
    // The backoff holds: a sweep before the retry is due does not spend another attempt.
    await smtpLink.start();
    await app.get(CommunicationsService).dispatchDue();
    expect(await prisma.message.count({ where: { eventId: wedding.eventId, attempts: 1, status: MessageStatus.QUEUED } })).toBe(2);

    await prisma.message.updateMany({ where: { eventId: wedding.eventId }, data: { scheduledFor: new Date(Date.now() - 1000) } });
    await app.get(CommunicationsService).dispatchDue();
    expect(await deliveryOf(wedding)).toEqual([
      { household: 'Armen Petrosyan', status: 'SENT', attempts: 2 },
      { household: 'Lusine Sargsyan', status: 'SENT', attempts: 2 },
    ]);
    // Each guest got exactly one invitation, carrying their own link.
    for (const guest of [wedding.lusine, wedding.armen]) {
      const messages = await prisma.message.findMany({ where: { eventId: wedding.eventId, toAddress: guest.email } });
      expect(messages).toHaveLength(1);
      expect(messages[0].body).toContain(guest.link);
    }
  };

  /** Step 2: Redis drops while the host edits and a guest answers, then returns. */
  const answersThroughARedisOutage = async (wedding: Wedding) => {
    expect(await heroTitle(wedding.lusine.link)).toBe('Ani & Narek are getting married');
    await redisLink.stop();
    const { body: degraded } = await readiness().expect(200);
    expect(degraded).toMatchObject({ status: 'degraded', required: { postgres: { isUp: true } }, optional: { redis: { isUp: false } } });

    await wedding.host.patch(`/invitations/${wedding.slug}/blocks/HERO`, { content: { en: { title: 'Ani & Narek: the date is set' } } }).expect(200);
    expect(await heroTitle(wedding.lusine.link)).toBe('Ani & Narek: the date is set');
    await http().post(api(`${wedding.lusine.link}/rsvp`)).send({ status: 'ATTENDING' }).expect(201);
    expect(await headcount(wedding)).toMatchObject({ invited: 2, attending: 1, pending: 1 });

    await redisIsBack();
    const { body: recovered } = await readiness().expect(200);
    expect(recovered.optional.redis.isUp).toBe(true);
    // What Redis held from before the outage is never served in place of the edit.
    expect(await heroTitle(wedding.lusine.link)).toBe('Ani & Narek: the date is set');
    expect(await heroTitle(wedding.armen.link)).toBe('Ani & Narek: the date is set');
  };

  /** Step 3: Postgres drops as a guest answers; nothing half-applies, and the same answer succeeds after. */
  const answersThroughAPostgresOutage = async (wedding: Wedding) => {
    await postgresLink.stop();
    const { body: down } = await readiness().expect(503);
    expect(down.message).toMatchObject({ status: 'unavailable', required: { postgres: { isUp: false } } });
    const refused = await http().post(api(`${wedding.armen.link}/rsvp`)).send({ status: 'DECLINED' });
    expect(refused.status).toBeGreaterThanOrEqual(500);
    expect(refused.body.action).toBe('RETRY');
    expect(await rsvpStatusOf(wedding.armen.id)).toBe('PENDING');

    await postgresIsBack();
    await http().post(api(`${wedding.armen.link}/rsvp`)).send({ status: 'DECLINED' }).expect(201);
    expect(await headcount(wedding)).toMatchObject({ invited: 2, attending: 1, declined: 1, pending: 0 });
    const { body: lusineSees } = await http().get(api(wedding.lusine.link)).expect(200);
    expect(lusineSees.guest.rsvp.status).toBe('ATTENDING');
  };

  it('delivers every invitation and keeps every answer through SMTP, Redis and Postgres outages without an API restart', async () => {
    const wedding = await publishedWedding();

    await sendsThroughAnSmtpOutage(wedding);
    await answersThroughARedisOutage(wedding);
    await answersThroughAPostgresOutage(wedding);
    // Nothing the outages interrupted was sent twice or left behind.
    expect(await prisma.message.groupBy({ by: ['status'], where: { eventId: wedding.eventId }, _count: true }))
      .toEqual([{ status: MessageStatus.SENT, _count: 2 }]);
  }, 60_000);

  /** A storage adapter whose chosen operation waits on a gate: the worker using it is "dead" mid-job. */
  const stalledStorage = (operation: 'get' | 'put') => {
    const stalled = stall();
    const real = app.get(PrivateStorageService);
    const adapter: PrivateStorage = {
      get: async (key) => { if (operation === 'get') { stalled.enter(); await stalled.gate; } return real.get(key); },
      put: async (key, buffer, mimeType) => { if (operation === 'put') { stalled.enter(); await stalled.gate; } return real.put(key, buffer, mimeType); },
      remove: (key) => real.remove(key),
      probe: () => real.probe(),
    };
    return { storage: new PrivateStorageService(adapter), ...stalled };
  };

  /** A planner that has captured its inputs and then stops, as a killed seating worker does. */
  const stalledPlanner = () => {
    const stalled = stall();
    const real = new SeatingPlanner();
    const planner = { plan: async (input: Parameters<SeatingPlanner['plan']>[0]) => { stalled.enter(); await stalled.gate; return real.plan(input); } };
    return { planner: planner, ...stalled };
  };

  const mediaWorker = () => new PrivateMediaRunner(database(), app.get(PrivateStorageService));
  const snapshotPath = (wedding: Wedding, id: string) => `${wedding.base}/export-snapshots/${id}`;
  const download = (wedding: Wedding, id: string) => wedding.host.get(`${snapshotPath(wedding, id)}/download`).buffer(true);
  const seatedNames = async (wedding: Wedding) =>
    ((await wedding.host.get(`${wedding.base}/tables`).expect(200)).body as TableView[]).flatMap((table) => table.guests.map((guest) => `${table.name}:${guest.name}`)).sort();
  const hostGallery = async (wedding: Wedding) => (await wedding.host.get(`${wedding.base}/gallery`).expect(200)).body.items as GalleryItem[];

  /** The private root becomes unreadable and unwritable at once, as an unmounted volume does. */
  const takePrivateStorageOffline = async () => {
    await rename(privateRoot(), `${privateRoot()}.offline`);
    await writeFile(privateRoot(), 'not a directory');
  };
  const bringPrivateStorageBack = async () => {
    await rm(privateRoot());
    await rename(`${privateRoot()}.offline`, privateRoot());
  };

  /** Steps 1-2: three workers each die holding a lease; the host sees the job running, not lost. */
  const workersDieMidJob = async (wedding: Wedding) => {
    const { body: photoUpload } = await http().post(api(`${wedding.lusine.link}/gallery`)).field('caption', 'Lusine at the engagement')
      .attach('file', await photo(), { filename: 'lusine.jpg', contentType: 'image/jpeg' }).expect(201);
    const { body: arrangements } = await wedding.host.get(`${wedding.base}/seating/arrangements`).expect(200);
    const arrangementId = (arrangements as { id: string; venueId: string | null }[]).find((item) => item.venueId === wedding.venueId)!.id;
    const { body: seatingJob } = await wedding.host.post(`${wedding.base}/seats/auto-assign?arrangementId=${arrangementId}`, { idempotencyKey: randomUUID() }).expect(201);
    const { body: snapshot } = await wedding.host.post(`${wedding.base}/export-snapshots`, { kind: 'GUEST_LIST', format: 'CSV', locale: 'en', idempotencyKey: randomUUID() }).expect(201);

    const exportStall = stalledStorage('put');
    const seatingStall = stalledPlanner();
    const mediaStall = stalledStorage('get');
    const zombies = Promise.all([
      new SeatingRunner(database(), app.get(SeatingQueue), seatingStall.planner).runOne(),
      new ExportRunner(database(), app.get(ExportQueue), exportStall.storage, app.get(OperationsService)).runOne(),
      new PrivateMediaRunner(database(), mediaStall.storage).runOne(),
    ]);
    await Promise.all([exportStall.hasEntered, seatingStall.hasEntered, mediaStall.hasEntered]);

    expect((await wedding.host.get(snapshotPath(wedding, snapshot.id as string)).expect(200)).body).toMatchObject({ status: 'RUNNING', attempts: 1, downloadPath: null });
    expect((await wedding.host.get(`${wedding.base}/seating/jobs/${seatingJob.id as string}`).expect(200)).body).toMatchObject({ status: 'RUNNING', attempts: 1, result: null });
    expect(await hostGallery(wedding)).toEqual([expect.objectContaining({ id: photoUpload.id, processingStatus: 'PROCESSING' })]);
    await download(wedding, snapshot.id as string).expect(409);
    const release = () => { exportStall.release(); seatingStall.release(); mediaStall.release(); };
    return { snapshotId: snapshot.id as string, seatingJobId: seatingJob.id as string, photoId: photoUpload.id as string, zombies, release };
  };
  type Abandoned = Awaited<ReturnType<typeof workersDieMidJob>>;

  /** Step 2: until the lease runs out, a replacement worker must not take the job from its holder. */
  const replacementsTakeOverAfterLeaseExpiry = async (wedding: Wedding, abandoned: Abandoned) => {
    expect(await app.get(SeatingRunner).runOne()).toBe(false);
    expect(await app.get(ExportRunner).runOne()).toBe(false);
    expect(await mediaWorker().runOne()).toBe(false);

    // Armen answers while the dead workers hold their leases: a recovered attempt captures afresh.
    await http().post(api(`${wedding.armen.link}/rsvp`)).send({ status: 'ATTENDING' }).expect(201);
    const expired = new Date(Date.now() - 1000);
    await prisma.seatingJob.update({ where: { id: abandoned.seatingJobId }, data: { leaseUntil: expired } });
    await prisma.exportSnapshot.update({ where: { id: abandoned.snapshotId }, data: { leaseUntil: expired } });
    await prisma.guestMedia.update({ where: { id: abandoned.photoId }, data: { leaseUntil: expired } });

    expect(await app.get(SeatingRunner).runOne()).toBe(true);
    expect(await app.get(ExportRunner).runOne()).toBe(true);
    expect(await mediaWorker().runOne()).toBe(true);
  };

  /** Step 2, the outcome: each job finished on attempt 2 with today's data, and each audience sees it. */
  const everyoneSeesTheRecoveredWork = async (wedding: Wedding, abandoned: Abandoned) => {
    const { body: seating } = await wedding.host.get(`${wedding.base}/seating/jobs/${abandoned.seatingJobId}`).expect(200);
    expect(seating).toMatchObject({ status: 'COMPLETED', attempts: 2, failureReason: null, result: { seated: 2, households: 2, unseated: [] } });
    expect(await seatedNames(wedding)).toEqual(['Table 1:Armen Petrosyan', 'Table 1:Lusine Sargsyan']);
    const { body: armenSees } = await http().get(api(wedding.armen.link)).expect(200);
    expect(armenSees.guest.seating.assignments).toEqual([expect.objectContaining({ table: 'Table 1' })]);

    const { body: snapshot } = await wedding.host.get(snapshotPath(wedding, abandoned.snapshotId)).expect(200);
    expect(snapshot).toMatchObject({ status: 'COMPLETED', attempts: 2, failureReason: null, downloadPath: expect.any(String) });
    const file = await download(wedding, abandoned.snapshotId).expect(200);
    expect(parseCsv(file.text).map((row) => [row['First name'], row.RSVP, row.Table])).toEqual(expect.arrayContaining([
      ['Lusine', 'ATTENDING', 'Table 1'], ['Armen', 'ATTENDING', 'Table 1'],
    ]));
    expect(parseCsv(file.text)).toHaveLength(2);

    expect(await prisma.guestMedia.findUniqueOrThrow({ where: { id: abandoned.photoId } })).toMatchObject({ processingStatus: 'READY', attempts: 2, failureReason: null });
    await wedding.host.patch(`${wedding.base}/gallery/${abandoned.photoId}`, { moderationStatus: 'APPROVED' }).expect(200);
    const { body: armenGallery } = await http().get(api(`${wedding.armen.link}/gallery`)).expect(200);
    expect(armenGallery.items).toEqual([expect.objectContaining({ id: abandoned.photoId, caption: 'Lusine at the engagement', isOwn: false })]);
    await http().get(api(`${wedding.armen.link}/gallery/${abandoned.photoId}/file`)).expect(200).expect('Content-Type', /image\/webp/);
    return file.text;
  };

  /** Step 2, the other side: the dead workers wake up late and must not change what was finished. */
  const lateWorkersChangeNothing = async (wedding: Wedding, abandoned: Abandoned, published: string) => {
    abandoned.release();
    expect(await abandoned.zombies).toEqual([true, true, true]);
    expect((await wedding.host.get(`${wedding.base}/seating/jobs/${abandoned.seatingJobId}`).expect(200)).body).toMatchObject({ status: 'COMPLETED', attempts: 2 });
    expect(await prisma.seat.count({ where: { guest: { eventId: wedding.eventId } } })).toBe(2);
    expect((await wedding.host.get(snapshotPath(wedding, abandoned.snapshotId)).expect(200)).body).toMatchObject({ status: 'COMPLETED', attempts: 2 });
    expect((await download(wedding, abandoned.snapshotId).expect(200)).text).toBe(published);
    expect(await prisma.guestMedia.findUniqueOrThrow({ where: { id: abandoned.photoId } })).toMatchObject({ processingStatus: 'READY', attempts: 2 });
  };

  /** Step 4: private storage goes away; downloads, uploads and exports fail safely, then all recover. */
  const privateStorageOutage = async (wedding: Wedding, publishedId: string, published: string) => {
    await takePrivateStorageOffline();
    let retriedId: string;
    try {
      await download(wedding, publishedId).expect(503);
      await wedding.host.get(`${wedding.base}/dashboard`).expect(200);
      await http().post(api(`${wedding.armen.link}/gallery`)).attach('file', await photo(), { filename: 'armen.jpg', contentType: 'image/jpeg' }).expect(503);
      const { body: queued } = await wedding.host.post(`${wedding.base}/export-snapshots`, { kind: 'GUEST_LIST', format: 'CSV', locale: 'en', idempotencyKey: randomUUID() }).expect(201);
      retriedId = queued.id as string;
      expect(await app.get(ExportRunner).runOne()).toBe(true);
      expect((await wedding.host.get(snapshotPath(wedding, retriedId)).expect(200)).body)
        .toMatchObject({ status: 'QUEUED', attempts: 1, failureReason: 'GENERATION_FAILED', downloadPath: null });
    } finally { await bringPrivateStorageBack(); }

    expect((await download(wedding, publishedId).expect(200)).text).toBe(published);
    await prisma.exportSnapshot.update({ where: { id: retriedId }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    expect(await app.get(ExportRunner).runOne()).toBe(true);
    expect((await wedding.host.get(snapshotPath(wedding, retriedId)).expect(200)).body).toMatchObject({ status: 'COMPLETED', attempts: 2, failureReason: null });
    expect(parseCsv((await download(wedding, retriedId).expect(200)).text)).toHaveLength(2);
    const { body: retake } = await http().post(api(`${wedding.armen.link}/gallery`)).attach('file', await photo(), { filename: 'armen.jpg', contentType: 'image/jpeg' }).expect(201);
    expect(await mediaWorker().runOne()).toBe(true);
    expect((await hostGallery(wedding)).find((item) => item.id === retake.id)).toMatchObject({ processingStatus: 'READY' });
  };

  it('finishes export, seating and photo jobs on attempt 2 after their workers die, and survives a private storage outage', async () => {
    const wedding = await publishedWedding();
    await http().post(api(`${wedding.lusine.link}/rsvp`)).send({ status: 'ATTENDING' }).expect(201);

    const abandoned = await workersDieMidJob(wedding);
    await replacementsTakeOverAfterLeaseExpiry(wedding, abandoned);
    const published = await everyoneSeesTheRecoveredWork(wedding, abandoned);
    await lateWorkersChangeNothing(wedding, abandoned, published);
    await privateStorageOutage(wedding, abandoned.snapshotId, published);
  }, 60_000);
});
