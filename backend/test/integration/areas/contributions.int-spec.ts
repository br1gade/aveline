import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GuestMediaKind, GuestMediaStatus, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { buildPrivateStorage, PrivateStorageService } from '../../../src/infra/storage/private/private-storage';
import { assertRequiredAcknowledgements } from '../../../src/modules/guest-contributions/acknowledgement-writes';
import { AcknowledgementsService } from '../../../src/modules/guest-contributions/acknowledgements.service';
import { GuestMediaService } from '../../../src/modules/guest-contributions/guest-media.service';
import { PrivateMediaRunner } from '../../../src/modules/guest-contributions/private-media-runner';
import { versionStatement } from '../../../src/modules/guest-contributions/statements';
import { PublicEventsService } from '../../../src/modules/public-events/public-events.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { seedEvent } from '../../fixtures/event.fixture';
import { ticketEvent } from '../../fixtures/tickets.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

describe('Private guest contributions (integration coverage)', () => {
  let prisma: PrismaClient; let database: PrismaService; let root: string; let storage: PrivateStorageService;
  let media: GuestMediaService; let runner: PrivateMediaRunner; let acknowledgements: AcknowledgementsService; let png: Buffer;
  beforeAll(async () => {
    prisma = testPrisma(); database = prisma as unknown as PrismaService;
    root = await mkdtemp(join(tmpdir(), 'aveline-contributions-coverage-'));
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
  type Setup = Awaited<ReturnType<typeof setup>>;
  const file = (buffer = png) => ({ buffer, mimetype: 'image/png' } as Express.Multer.File);
  const statement = (event: Setup) => prisma.$transaction(async (tx) => {
    const invitation = await tx.invitation.findUniqueOrThrow({ where: { slug: event.slug } });
    const question = await tx.rsvpQuestion.create({ data: { invitationId: invitation.id, type: 'SIGNATURE', required: true, prompt: { en: 'Venue rules' } } });
    return (await versionStatement(tx, question))!;
  });
  const sign = (event: Setup, version: string, extra = {}) => acknowledgements.sign(event.slug, event.guest.token, {
    statementVersionId: version, subjectGuestIds: [event.guest.id], method: 'TYPED', signerName: 'Primary Guest', isAcknowledged: true, locale: 'en', ...extra,
  });
  const gate = (event: Setup) => prisma.$transaction((tx) => assertRequiredAcknowledgements(tx, event.eventId, [event.guest.id]));
  const ledger = (id: string) => prisma.guestMedia.findUniqueOrThrow({ where: { id } });
  const row = (event: Setup, data: { kind: GuestMediaKind; processingStatus: GuestMediaStatus; leaseUntil?: Date; uploaderGuestId?: string | null }) =>
    prisma.guestMedia.create({ data: { eventId: event.eventId, uploaderGuestId: event.guest.id, sourceKey: randomUUID(), displayKey: randomUUID(), mimeType: 'image/png',
      sourceBytes: 1, storedBytes: 1, reservedBytes: 1, ...data } });
  const age = (id: string, column: 'createdAt' | 'updatedAt', days: number) =>
    prisma.$executeRawUnsafe(`UPDATE guest_media SET "${column}" = now() - interval '${days} days' WHERE id = $1`, id);

  describe('the required-acknowledgement gate', () => {
    it('stops counting a drawn acknowledgement once its drawing leaves READY', async () => {
      const event = await setup(); const version = await statement(event);
      const drawing = await media.upload(event.link, 'SIGNATURE', file()); await runner.runOne();
      await sign(event, version, { method: 'DRAWN', assetId: drawing.id });
      await expect(gate(event)).resolves.toBeUndefined();
      await prisma.guestMedia.update({ where: { id: drawing.id }, data: { processingStatus: 'REMOVED' } });
      await expect(gate(event)).rejects.toThrow(/^acknowledgements: /);
    });
    it('counts a typed acknowledgement of the same statement without any media', async () => {
      const event = await setup(); const version = await statement(event);
      const drawing = await media.upload(event.link, 'SIGNATURE', file()); await runner.runOne();
      await sign(event, version, { method: 'DRAWN', assetId: drawing.id });
      await prisma.guestMedia.update({ where: { id: drawing.id }, data: { processingStatus: 'FAILED' } });
      await sign(event, version);
      await expect(gate(event)).resolves.toBeUndefined();
    });
  });

  describe('ticket checkout metadata', () => {
    it('lists only required signature statements before check-in and keeps them out of buyer questions', async () => {
      const event = await ticketEvent(prisma);
      await prisma.event.update({ where: { id: event.eventId }, data: { locales: ['en', 'fr', 'hy'] } });
      const invitation = await prisma.invitation.findUniqueOrThrow({ where: { eventId: event.eventId } });
      const required = await prisma.rsvpQuestion.create({ data: { invitationId: invitation.id, type: 'SIGNATURE', required: true, sortOrder: 0, prompt: { en: 'Rules', fr: 'Règles' } } });
      await prisma.rsvpQuestion.create({ data: { invitationId: invitation.id, type: 'SIGNATURE', required: false, sortOrder: 1, prompt: { en: 'Optional', fr: 'Facultatif' } } });
      const text = await prisma.rsvpQuestion.create({ data: { invitationId: invitation.id, type: 'TEXT', sortOrder: 2, prompt: { en: 'Meal?', fr: 'Repas?' } } });
      const page = await new PublicEventsService(database).findBySlug(event.slug, 'fr');
      expect(page.checkout.acknowledgementsRequiredBeforeCheckIn).toEqual([{ questionId: required.id, prompt: 'Règles' }]);
      expect(page.checkout.questions.map((question: { id: string }) => question.id)).toEqual([text.id]);
    });
  });

  describe('gallery moderation visibility', () => {
    it('keeps a rejected photo visible to its uploader and hidden from every other guest', async () => {
      const event = await setup(); const uploaded = await media.upload(event.link, 'GALLERY', file()); await runner.runOne();
      await media.moderate(event.eventId, uploaded.id, 'REJECTED', 'host');
      const own = await media.listGuest(event.slug, event.guest.token, { limit: 30 });
      expect(own.items).toEqual([expect.objectContaining({ id: uploaded.id, moderationStatus: 'REJECTED', isOwn: true })]);
      await expect(media.readGuest(event.link, uploaded.id, { kind: 'GALLERY', variant: 'display' })).resolves.toHaveProperty('mimeType', 'image/webp');
      expect((await media.listGuest(event.slug, event.other.token, { limit: 30 })).items).toEqual([]);
      await expect(media.readGuest(event.otherLink, uploaded.id, { kind: 'GALLERY', variant: 'display' })).rejects.toThrow('No image');
    });
  });

  describe('a private storage outage during upload', () => {
    it('answers 503 and leaves the staged ledger row REMOVED for cleanup', async () => {
      const event = await setup();
      jest.spyOn(storage, 'put').mockRejectedValueOnce(new Error('down'));
      const failure = await media.upload(event.link, 'GALLERY', file(), 'Caption').catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ServiceUnavailableException);
      expect((failure as ServiceUnavailableException).getStatus()).toBe(503);
      const [staged] = await prisma.guestMedia.findMany();
      expect(staged).toMatchObject({ processingStatus: 'REMOVED', removedAt: expect.any(Date) as Date, cleanupAfter: expect.any(Date) as Date });
      expect(staged.reservedBytes).toBeGreaterThan(0);
      await runner.cleanup();
      expect(await ledger(staged.id)).toMatchObject({ reservedBytes: 0, clearedAt: expect.any(Date) as Date });
    });
  });

  describe('worker attempts', () => {
    it('requeues an image with STORAGE_UNAVAILABLE when the original cannot be read', async () => {
      const event = await setup(); const uploaded = await media.upload(event.link, 'GALLERY', file());
      jest.spyOn(storage, 'get').mockRejectedValueOnce(new Error('down'));
      await runner.runOne();
      expect(await ledger(uploaded.id)).toMatchObject({ processingStatus: 'QUEUED', failureReason: 'STORAGE_UNAVAILABLE', attempts: 1, claimToken: null });
    });
    it('fails a storage error on the third attempt instead of requeueing', async () => {
      const event = await setup(); const uploaded = await media.upload(event.link, 'GALLERY', file());
      await prisma.guestMedia.update({ where: { id: uploaded.id }, data: { attempts: 2 } });
      jest.spyOn(storage, 'get').mockRejectedValueOnce(new Error('down'));
      await runner.runOne();
      expect(await ledger(uploaded.id)).toMatchObject({ processingStatus: 'FAILED', failureReason: 'STORAGE_UNAVAILABLE', attempts: 3 });
    });
    it('marks an image that already used three attempts FAILED with ATTEMPTS_EXHAUSTED', async () => {
      const event = await setup(); const uploaded = await media.upload(event.link, 'GALLERY', file());
      await prisma.guestMedia.update({ where: { id: uploaded.id }, data: { attempts: 3 } });
      await runner.runOne();
      expect(await ledger(uploaded.id)).toMatchObject({ processingStatus: 'FAILED', failureReason: 'ATTEMPTS_EXHAUSTED', attempts: 3 });
    });
    it('accepts an identical output already written when a retried write reports an error', async () => {
      const event = await setup(); const uploaded = await media.upload(event.link, 'GALLERY', file());
      const put = storage.put.bind(storage);
      jest.spyOn(storage, 'put').mockImplementation(async (key, buffer, type) => { await put(key, buffer, type); throw new Error('already exists'); });
      await runner.runOne();
      expect(await ledger(uploaded.id)).toMatchObject({ processingStatus: 'READY', failureReason: null });
    });
    it('requeues when an output write fails and nothing identical exists', async () => {
      const event = await setup(); const uploaded = await media.upload(event.link, 'GALLERY', file());
      jest.spyOn(storage, 'put').mockRejectedValue(new Error('down'));
      await runner.runOne();
      expect(await ledger(uploaded.id)).toMatchObject({ processingStatus: 'QUEUED', failureReason: 'STORAGE_UNAVAILABLE', attempts: 1 });
    });
  });

  describe('cleanup of abandoned items', () => {
    const seedRows = async (event: Setup) => {
      const version = await statement(event);
      const claimed = await row(event, { kind: 'SIGNATURE', processingStatus: 'READY' });
      await sign(event, version, { method: 'DRAWN', assetId: claimed.id });
      const rows = {
        expiredStaging: await row(event, { kind: 'GALLERY', processingStatus: 'STAGING', leaseUntil: new Date(Date.now() - 3_600_000) }),
        oldUnclaimedDrawing: await row(event, { kind: 'SIGNATURE', processingStatus: 'READY' }),
        oldFailedPhoto: await row(event, { kind: 'GALLERY', processingStatus: 'FAILED' }),
        uploaderGone: await row(event, { kind: 'GALLERY', processingStatus: 'READY', uploaderGuestId: null }),
        liveStaging: await row(event, { kind: 'GALLERY', processingStatus: 'STAGING', leaseUntil: new Date(Date.now() + 3_600_000) }),
        freshUnclaimedDrawing: await row(event, { kind: 'SIGNATURE', processingStatus: 'READY' }),
        freshFailedPhoto: await row(event, { kind: 'GALLERY', processingStatus: 'FAILED' }),
        oldClaimedDrawing: claimed,
      };
      await age(rows.oldUnclaimedDrawing.id, 'createdAt', 2); await age(rows.oldClaimedDrawing.id, 'createdAt', 2);
      await age(rows.oldFailedPhoto.id, 'updatedAt', 2);
      await age(rows.freshUnclaimedDrawing.id, 'createdAt', 0.04);
      return rows;
    };
    it('removes expired staging, day-old unclaimed drawings, day-old failures and uploader-less rows only', async () => {
      const event = await setup(); const rows = await seedRows(event);
      await runner.cleanup();
      const states = Object.fromEntries(await Promise.all(Object.entries(rows).map(async ([name, item]) => [name, (await ledger(item.id)).processingStatus])));
      expect(states).toEqual({ expiredStaging: 'REMOVED', oldUnclaimedDrawing: 'REMOVED', oldFailedPhoto: 'REMOVED', uploaderGone: 'REMOVED',
        liveStaging: 'STAGING', freshUnclaimedDrawing: 'READY', freshFailedPhoto: 'FAILED', oldClaimedDrawing: 'READY' });
    });
    it('releases the reserved bytes of each abandoned item it removes', async () => {
      const event = await setup(); const rows = await seedRows(event);
      await runner.cleanup();
      expect(await ledger(rows.expiredStaging.id)).toMatchObject({ reservedBytes: 0, clearedAt: expect.any(Date) as Date });
      expect(await ledger(rows.liveStaging.id)).toMatchObject({ reservedBytes: 1, clearedAt: null });
    });
  });
});
