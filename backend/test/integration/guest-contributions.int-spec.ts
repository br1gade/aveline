import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { synchronizeAdmission } from '../../src/modules/ticketing/ticket-link';
import { Ticket } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PrivateStorageService, buildPrivateStorage } from '../../src/infra/storage/private/private-storage';
import { GuestMediaService, GALLERY_BYTE_LIMIT } from '../../src/modules/guest-contributions/guest-media.service';
import { PrivateMediaRunner } from '../../src/modules/guest-contributions/private-media-runner';
import { AcknowledgementsService } from '../../src/modules/guest-contributions/acknowledgements.service';
import { ContributionPrivacyFiles, eraseContributions, exportContributions } from '../../src/modules/guest-contributions/contribution-privacy';
import { versionStatement } from '../../src/modules/guest-contributions/statements';
import { GuestManagementService } from '../../src/modules/guests/guest-management.service';
import { writeAcknowledgement, assertRequiredAcknowledgements } from '../../src/modules/guest-contributions/acknowledgement-writes';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma, TEST_DATABASE_URL } from '../setup/test-database';

describe('Private guest contributions (integration)', () => {
  let prisma: PrismaClient; let database: PrismaService; let root: string; let storage: PrivateStorageService;
  let media: GuestMediaService; let runner: PrivateMediaRunner; let acknowledgements: AcknowledgementsService; let png: Buffer;
  beforeAll(async () => {
    prisma = testPrisma(); database = prisma as unknown as PrismaService;
    root = await mkdtemp(join(tmpdir(), 'aveline-contributions-'));
    storage = new PrivateStorageService(buildPrivateStorage(new ConfigService({ S3_ENDPOINT: '', STORAGE_ROOT: join(root, 'public'), PRIVATE_STORAGE_ROOT: join(root, 'private') })));
    png = await sharp({ create: { width: 20, height: 20, channels: 4, background: '#123456' } }).png().toBuffer();
    media = new GuestMediaService(database, storage); runner = new PrivateMediaRunner(database, storage); acknowledgements = new AcknowledgementsService(database);
  });
  beforeEach(() => resetTestDatabase());
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => { await rm(root, { recursive: true, force: true }); await disconnectTestDatabase(); });
  const setup = async () => {
    const event = await seedEvent(prisma); const guest = await prisma.guest.findUniqueOrThrow({ where: { token: event.primaryGuestToken } });
    const other = await prisma.guest.create({ data: { eventId: event.eventId, householdId: event.householdId, firstName: 'Member', token: randomUUID() } });
    return { ...event, guest, other, link: { slug: event.slug, token: guest.token }, otherLink: { slug: event.slug, token: other.token } };
  };
  const file = (buffer = png) => ({ buffer, mimetype: 'image/png' } as Express.Multer.File);
  const statement = async (event: Awaited<ReturnType<typeof setup>>) => prisma.$transaction(async (tx) => {
    const invitation = await tx.invitation.findUniqueOrThrow({ where: { slug: event.slug } });
    const question = await tx.rsvpQuestion.create({ data: { invitationId: invitation.id, type: 'SIGNATURE', required: true, prompt: { en: 'Venue rules' } } });
    const version = await versionStatement(tx, question);
    return { question, version: version! };
  });
  const sign = (event: Awaited<ReturnType<typeof setup>>, version: string, extra = {}) => acknowledgements.sign(event.slug, event.guest.token, {
    statementVersionId: version, subjectGuestIds: [event.guest.id], method: 'TYPED', signerName: 'Primary Guest', isAcknowledged: true, locale: 'en', ...extra,
  });

  it('backfills existing signature wording without overwriting already versioned statements', async () => {
    const event = await setup(); const existing = await statement(event);
    const legacy = await prisma.rsvpQuestion.create({ data: { invitationId: existing.question.invitationId, type: 'SIGNATURE', prompt: { en: 'Imported statement' } } });
    const migration = await readFile(join(process.cwd(), 'prisma/migrations/20261019120000_existing_signature_statements/migration.sql'), 'utf8');
    await prisma.$executeRawUnsafe(migration);
    const fixed = await prisma.rsvpQuestion.findUniqueOrThrow({ where: { id: legacy.id }, include: { currentStatement: true } });
    expect(fixed.currentStatement).toMatchObject({ revision: 1, prompt: { en: 'Imported statement' } });
    expect((await prisma.rsvpQuestion.findUniqueOrThrow({ where: { id: existing.question.id } })).statementVersionId).toBe(existing.version);
  });
  it('keeps processed photos private until approval and allows the owner to remove approved files', async () => {
    const event = await setup(); const uploaded = await media.upload(event.link, 'GALLERY', file(), 'An evening');
    await expect(media.moderate(event.eventId, uploaded.id, 'APPROVED', 'host')).rejects.toThrow('finish processing');
    await runner.runOne();
    expect((await media.listGuest(event.slug, event.other.token, { limit: 30 })).items).toEqual([]);
    await expect(media.readGuest(event.otherLink, uploaded.id, { kind: 'GALLERY', variant: 'display' })).rejects.toThrow('No image');
    await media.moderate(event.eventId, uploaded.id, 'APPROVED', 'host');
    expect((await media.listGuest(event.slug, event.other.token, { limit: 30 })).items).toHaveLength(1);
    const image = await media.readGuest(event.otherLink, uploaded.id, { kind: 'GALLERY', variant: 'thumbnail' });
    expect(image.mimeType).toBe('image/webp'); expect((await sharp(image.buffer).metadata()).width).toBe(20);
    await expect(media.removeGuest(event.otherLink, uploaded.id, 'GALLERY')).rejects.toThrow('No such');
    await media.removeGuest(event.link, uploaded.id, 'GALLERY');
    await expect(media.readHost(event.eventId, uploaded.id, 'GALLERY', 'display')).rejects.toThrow('No image');
    const ledger = await prisma.guestMedia.findUniqueOrThrow({ where: { id: uploaded.id } });
    await runner.cleanup();
    await expect(storage.get(ledger.sourceKey)).rejects.toThrow(); await expect(storage.get(ledger.displayKey!)).rejects.toThrow();
    expect(await prisma.mediaAsset.count()).toBe(0);
  });
  it('rechecks visibility after reading storage and never crosses image kinds', async () => {
    const event = await setup(); const uploaded = await media.upload(event.link, 'GALLERY', file()); await runner.runOne();
    await media.moderate(event.eventId, uploaded.id, 'APPROVED', 'host');
    await expect(media.readGuest(event.link, uploaded.id, { kind: 'SIGNATURE', variant: 'display' })).rejects.toThrow('No image');
    const get = storage.get.bind(storage);
    jest.spyOn(storage, 'get').mockImplementationOnce(async (key) => { const data = await get(key); await media.removeGuest(event.link, uploaded.id, 'GALLERY'); return data; });
    await expect(media.readGuest(event.otherLink, uploaded.id, { kind: 'GALLERY', variant: 'display' })).rejects.toThrow('No image');
  });
  it('rejects spoofed raster images in the worker without exposing the original', async () => {
    const event = await setup(); const uploaded = await media.upload(event.link, 'GALLERY', file(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')));
    await runner.runOne(); expect(await prisma.guestMedia.findUnique({ where: { id: uploaded.id } })).toMatchObject({ processingStatus: 'FAILED', failureReason: 'INVALID_IMAGE' });
    await expect(media.readGuest(event.link, uploaded.id, { kind: 'GALLERY', variant: 'display' })).rejects.toThrow('No image');
  });
  it('serializes the last per-guest slot across concurrent uploads', async () => {
    const event = await setup();
    await prisma.guestMedia.createMany({ data: Array.from({ length: 19 }, () => ({ eventId: event.eventId, uploaderGuestId: event.guest.id, kind: 'GALLERY' as const,
      sourceKey: randomUUID(), mimeType: 'image/png', sourceBytes: 1, storedBytes: 1, reservedBytes: 1 })) });
    const attempts = await Promise.allSettled([media.upload(event.link, 'GALLERY', file()), media.upload(event.link, 'GALLERY', file())]);
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await prisma.guestMedia.count()).toBe(20);
  });
  it.each([999, 1000])('enforces the event photo boundary at %i photos', async (count) => {
    const event = await setup();
    await prisma.guestMedia.createMany({ data: Array.from({ length: count }, () => ({ eventId: event.eventId, uploaderGuestId: event.other.id, kind: 'GALLERY' as const,
      sourceKey: randomUUID(), mimeType: 'image/png', sourceBytes: 1, storedBytes: 1, reservedBytes: 1 })) });
    const result = await Promise.allSettled([media.upload(event.link, 'GALLERY', file())]);
    expect(result[0].status).toBe(count === 999 ? 'fulfilled' : 'rejected');
  });
  it('reserves derivative space and retains removed-file bytes until cleanup succeeds', async () => {
    const event = await setup();
    await prisma.guestMedia.create({ data: { eventId: event.eventId, uploaderGuestId: event.other.id, kind: 'GALLERY', sourceKey: randomUUID(), mimeType: 'image/png',
      sourceBytes: 1, storedBytes: 1, reservedBytes: GALLERY_BYTE_LIMIT - 1, processingStatus: 'REMOVED', removedAt: new Date(), cleanupAfter: new Date() } });
    await expect(media.upload(event.link, 'GALLERY', file())).rejects.toThrow('storage limit');
    await runner.cleanup(); await expect(media.upload(event.link, 'GALLERY', file())).resolves.toHaveProperty('id');
  });
  it('reports a domain conflict at the exact 2 GiB aggregate boundary', async () => {
    const event = await setup();
    await prisma.guestMedia.createMany({ data: Array.from({ length: 2 }, () => ({ eventId: event.eventId, uploaderGuestId: event.other.id, kind: 'GALLERY' as const,
      sourceKey: randomUUID(), mimeType: 'image/png', sourceBytes: 1, storedBytes: 1, reservedBytes: 1_073_741_824 })) });
    await expect(media.upload(event.link, 'GALLERY', file())).rejects.toThrow('storage limit');
  });
  it('recovers abandoned claims without losing output keys and cannot publish a removed claim', async () => {
    const event = await setup(); const uploaded = await media.upload(event.link, 'GALLERY', file());
    const displayKey = randomUUID(); const thumbnailKey = randomUUID();
    await prisma.guestMedia.update({ where: { id: uploaded.id }, data: { processingStatus: 'PROCESSING', attempts: 1, claimToken: randomUUID(), leaseUntil: new Date(0), displayKey, thumbnailKey } });
    await runner.runOne(); expect(await prisma.guestMedia.findUnique({ where: { id: uploaded.id } })).toMatchObject({ processingStatus: 'READY', attempts: 2, displayKey, thumbnailKey });
    const second = await media.upload(event.link, 'GALLERY', file()); const put = storage.put.bind(storage);
    jest.spyOn(storage, 'put').mockImplementationOnce(async (key, buffer, type) => { await media.removeGuest(event.link, second.id, 'GALLERY'); await put(key, buffer, type); });
    await runner.runOne(); expect(await prisma.guestMedia.findUnique({ where: { id: second.id } })).toMatchObject({ processingStatus: 'REMOVED' });
    await runner.cleanup();
    const dead = await prisma.guestMedia.findUniqueOrThrow({ where: { id: second.id } });
    await expect(storage.get(dead.displayKey!)).rejects.toThrow();
    await put(dead.displayKey!, png, 'image/png');
    await prisma.guestMedia.update({ where: { id: dead.id }, data: { cleanupAfter: new Date(0) } });
    await runner.cleanup(); await expect(storage.get(dead.displayKey!)).rejects.toThrow();
  });
  it('skips abandoned drawings while a signer holds their image lock', async () => {
    const event = await setup(); const { version } = await statement(event); const uploaded = await media.upload(event.link, 'SIGNATURE', file()); await runner.runOne();
    await prisma.guestMedia.update({ where: { id: uploaded.id }, data: { createdAt: new Date(Date.now() - 2 * 86_400_000) } });
    let release = () => undefined as void; let locked = () => undefined as void;
    const isLocked = new Promise<void>((resolve) => { locked = resolve; });
    const canFinish = new Promise<void>((resolve) => { release = resolve; });
    const signing = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM guest_media WHERE id = ${uploaded.id} FOR SHARE`;
      locked(); await canFinish;
      await writeAcknowledgement(tx, event.guest.id, { statementVersionId: version, method: 'DRAWN', assetId: uploaded.id, signerName: 'Primary', isAcknowledged: true, locale: 'en' }, event.guest.id);
    }, { timeout: 10_000 });
    await isLocked;
    const cleanup = runner.cleanup();
    let completion;
    try { completion = await Promise.race([cleanup.then(() => 'skipped'), delay(500).then(() => 'blocked')]); }
    finally { release(); await signing; await cleanup; }
    expect(completion).toBe('skipped');
    expect(await prisma.guestMedia.findUnique({ where: { id: uploaded.id } })).toMatchObject({ processingStatus: 'READY' });
    expect(await prisma.guestAcknowledgement.count()).toBe(1);
  });
  it('runs recovery in the separate worker process and shuts down gracefully', async () => {
    const event = await setup(); const uploaded = await media.upload(event.link, 'GALLERY', file());
    await prisma.guestMedia.update({ where: { id: uploaded.id }, data: { processingStatus: 'PROCESSING', attempts: 1, leaseUntil: new Date(0), claimToken: randomUUID() } });
    const heartbeat = join(root, 'worker-heartbeat');
    const child = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', 'src/private-media-worker.ts'], {
      cwd: process.cwd(), stdio: 'ignore', env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: TEST_DATABASE_URL, ANALYTICS_ENABLED: 'false',
        S3_ENDPOINT: '', STORAGE_ROOT: join(root, 'public'), PRIVATE_STORAGE_ROOT: join(root, 'private'),
        TS_NODE_PROJECT: 'tsconfig.build.json', PRIVATE_MEDIA_WORKER_HEARTBEAT_PATH: heartbeat },
    });
    const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
    try {
      const deadline = Date.now() + 15_000;
      let state;
      do {
        state = await prisma.guestMedia.findUniqueOrThrow({ where: { id: uploaded.id } });
        if (state.processingStatus === 'READY') break;
        await delay(100);
      } while (Date.now() < deadline);
      expect(state).toMatchObject({ processingStatus: 'READY', attempts: 2 });
      child.kill('SIGTERM'); expect(await exited).toBe(0);
      expect(Number(await readFile(heartbeat, 'utf8'))).toBeGreaterThan(Date.now() - 30_000);
    } finally { child.kill('SIGKILL'); await exited; }
  });
  it('reclaims files after event deletion and abandoned staging', async () => {
    const event = await setup(); const uploaded = await media.upload(event.link, 'GALLERY', file());
    const row = await prisma.guestMedia.findUniqueOrThrow({ where: { id: uploaded.id } });
    await prisma.event.delete({ where: { id: event.eventId } });
    await runner.cleanup(); await expect(storage.get(row.sourceKey)).rejects.toThrow();
    expect(await prisma.guestMedia.findUnique({ where: { id: row.id } })).toMatchObject({ eventId: null, processingStatus: 'REMOVED', reservedBytes: 0 });
  });
  it('accepts only the signer’s own processed drawing and deduplicates repeated acknowledgements', async () => {
    const event = await setup(); const { version } = await statement(event); const own = await media.upload(event.link, 'SIGNATURE', file());
    await expect(sign(event, version, { method: 'DRAWN', assetId: own.id })).rejects.toThrow('processed signature');
    await runner.runOne();
    const foreign = await media.upload(event.otherLink, 'SIGNATURE', file()); await runner.runOne();
    await expect(sign(event, version, { method: 'DRAWN', assetId: foreign.id })).rejects.toThrow('your own');
    const first = await sign(event, version, { method: 'DRAWN', assetId: own.id }); const retry = await sign(event, version, { method: 'DRAWN', assetId: own.id });
    expect(retry.records[0].id).toBe(first.records[0].id);
    await expect(media.removeGuest(event.link, own.id, 'SIGNATURE')).rejects.toThrow('part of an acknowledgement');
    await prisma.$transaction((tx) => assertRequiredAcknowledgements(tx, event.eventId, [event.guest.id]));
  });
  it('retains evidence during ordinary guest deletion and uses verified privacy erasure instead', async () => {
    const event = await setup(); const { version } = await statement(event); await sign(event, version);
    await expect(new GuestManagementService(database).removeGuest(event.eventId, event.guest.id)).rejects.toThrow('acknowledgement');
    expect(await prisma.guestAcknowledgement.count()).toBe(1);
  });
  it('erases represented records and linked RSVP references when the actual signer is erased', async () => {
    const event = await setup(); const { version, question } = await statement(event); const drawing = await media.upload(event.link, 'SIGNATURE', file()); await runner.runOne();
    const { records } = await sign(event, version, { method: 'DRAWN', assetId: drawing.id, subjectGuestIds: [event.other.id], isRepresentative: true });
    const response = await prisma.rsvp.create({ data: { guestId: event.other.id } });
    await prisma.rsvpAnswer.create({ data: { rsvpId: response.id, questionId: question.id, value: { acknowledgementId: records[0].id } } });
    const result = await prisma.$transaction((tx) => eraseContributions(tx, [event.guest.id], new Date()));
    expect(result).toEqual({ acknowledgementsErased: 1, privateMediaQueuedForDeletion: 1 }); expect(await prisma.rsvpAnswer.count()).toBe(0);
    await runner.cleanup(); expect(await prisma.guestMedia.findUnique({ where: { id: drawing.id } })).toMatchObject({ processingStatus: 'REMOVED', uploaderGuestId: null, reservedBytes: 0 });
  });
  it('does not create admission through legacy ticket reconciliation before required acknowledgement', async () => {
    const event = await setup(); const { version } = await statement(event);
    const ticket = { status: 'USED', usedAt: new Date() } as Ticket;
    await expect(prisma.$transaction((tx) => synchronizeAdmission(tx, ticket, { id: event.guest.id, checkIn: null }))).rejects.toThrow('acknowledgements');
    expect(await prisma.checkIn.count()).toBe(0);
    await sign(event, version);
    await prisma.$transaction((tx) => synchronizeAdmission(tx, ticket, { id: event.guest.id, checkIn: null }));
    expect(await prisma.checkIn.count()).toBe(1);
  });
  it('exports private files only for the verified matching subject and excludes storage credentials', async () => {
    const event = await setup(); await prisma.guest.update({ where: { id: event.guest.id }, data: { email: 'person@test.local' } });
    const image = await media.upload(event.link, 'GALLERY', file());
    const request = await prisma.dataSubjectRequest.create({ data: { kind: 'EXPORT', subjectEmail: 'person@test.local', dueAt: new Date(Date.now() + 86_400_000) } });
    const files = new ContributionPrivacyFiles(database, storage);
    await expect(files.read(request.id, image.id)).rejects.toThrow('Verify');
    await prisma.dataSubjectRequest.update({ where: { id: request.id }, data: { status: 'IN_PROGRESS' } });
    expect((await files.read(request.id, image.id)).buffer).toEqual(png);
    const exported = await exportContributions(database, 'PERSON@test.local', request.id);
    expect(exported.media[0].fileDownloadPath).toContain(request.id); expect(JSON.stringify(exported)).not.toMatch(/sourceKey|displayKey|token/);
    await prisma.dataSubjectRequest.update({ where: { id: request.id }, data: { subjectEmail: 'stranger@test.local' } });
    await expect(files.read(request.id, image.id)).rejects.toThrow('No file');
  });
});
