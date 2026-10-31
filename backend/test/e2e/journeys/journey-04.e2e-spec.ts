import type { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ThrottlerStorage } from '@nestjs/throttler';
import { PlatformRole, PrismaClient } from '@prisma/client';
import { hashSync } from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { SerializeInterceptor } from '../../../src/common/interceptors/serialize';
import { buildPrivateStorage, PRIVATE_STORAGE, PrivateStorageService } from '../../../src/infra/storage/private/private-storage';
import { PrivateMediaRunner } from '../../../src/modules/guest-contributions/private-media-runner';
import { InvitationMaintenanceService } from '../../../src/modules/invitations/invitation-maintenance.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { drawing, drawn, guestBase, PNG_SIGNATURE, typed } from '../../fixtures/areas/contributions.fixture';
import { parseCsv } from '../../fixtures/areas/journey-05.fixture';
import { seedEvent } from '../../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

const DAY_MS = 86_400_000;
const HOST_EMAIL = 'nare.host@aveline.test';
const HOST_PASSWORD = 'journey-04-host-password';
const UNTHROTTLED: ThrottlerStorage = {
  increment: () => Promise.resolve({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
};
/** Only the calendar is faked, and held still so the deadline is hit to the millisecond; every timer, tick and microtask stays real so Nest, Prisma and supertest run as usual. */
const REAL_TIMERS = ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
  'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] as const;

interface Media { id: string; kind: string; processingStatus: string; moderationStatus: string; caption: string | null; isOwn?: boolean }

/**
 * Journey 4: what guests contribute to an invitation, and what is left of it
 * once the invitation's lifetime runs out.
 *
 *   Nare hosts. Household Petrosyan: Anna signs for herself and, as the
 *   household's representative, for her brother Davit. Household Sargsyan:
 *   Lilit draws her signature. Davit, Lilit and Anna each share a photo.
 *   The invitation then expires the way it does in production — ninety days
 *   after the event ends, as captured at publication — and the maintenance
 *   sweep records it.
 */
describe('Journey 04: guest acknowledgements and the moderated gallery survive invitation expiry for the host (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let root: string;
  const http = () => request(app.getHttpServer() as Server);
  const api = (path: string) => `/api/v1${path}`;

  beforeAll(async () => {
    prisma = testPrisma();
    root = await mkdtemp(join(tmpdir(), 'aveline-journey-04-'));
    const storage = buildPrivateStorage(new ConfigService({ S3_ENDPOINT: '', STORAGE_ROOT: join(root, 'public'), PRIVATE_STORAGE_ROOT: join(root, 'private') }));
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(prisma)
      .overrideProvider(PRIVATE_STORAGE).useValue(storage)
      // Three households and a host make dozens of calls in a second; rate-limiting.e2e owns that rule.
      .overrideProvider(ThrottlerStorage).useValue(UNTHROTTLED)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalInterceptors(new SerializeInterceptor());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    // The media worker and the expiry sweep are driven in-process; a wall-clock cron would race them.
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) await job.stop();
  });
  beforeEach(() => resetTestDatabase());
  afterEach(() => { jest.useRealTimers(); });
  afterAll(async () => { await app.close(); await rm(root, { recursive: true, force: true }); await disconnectTestDatabase(); });

  const runMediaWorker = async () => {
    const runner = new PrivateMediaRunner(prisma as unknown as PrismaService, app.get(PrivateStorageService));
    let processed = 0;
    while (await runner.runOne()) processed += 1;
    return processed;
  };
  const cleanupMedia = () => new PrivateMediaRunner(prisma as unknown as PrismaService, app.get(PrivateStorageService)).cleanup();
  const storedFile = (key: string) => app.get(PrivateStorageService).get(key);

  /** The host signs in with a password, as she would again months later. */
  const signIn = async () => {
    const { body } = await http().post(api('/auth/login')).send({ email: HOST_EMAIL, password: HOST_PASSWORD }).expect(201);
    return `Bearer ${body.accessToken as string}`;
  };

  /** Two households on an unpublished invitation whose event ends 31 days from now. */
  const seedWedding = async () => {
    const seeded = await seedEvent(prisma, { isPublished: false, visibility: 'UNLISTED' });
    const startsAt = new Date(Date.now() + 30 * DAY_MS); const endsAt = new Date(startsAt.getTime() + DAY_MS);
    await prisma.event.update({ where: { id: seeded.eventId }, data: { startsAt, endsAt } });
    const host = await prisma.user.create({ data: { email: HOST_EMAIL, name: 'Nare', passwordHash: hashSync(HOST_PASSWORD, 4) } });
    await prisma.eventMembership.create({ data: { userId: host.id, eventId: seeded.eventId, role: 'OWNER' } });
    const anna = await prisma.guest.update({ where: { token: seeded.primaryGuestToken }, data: { firstName: 'Anna', lastName: 'Petrosyan' } });
    const davit = await prisma.guest.create({ data: { eventId: seeded.eventId, householdId: seeded.householdId, firstName: 'Davit', lastName: 'Petrosyan', token: 'journey04davitlink' } });
    const sargsyan = await prisma.household.create({ data: { eventId: seeded.eventId, name: 'Sargsyan', seatsAllotted: 1 } });
    const lilit = await prisma.guest.create({ data: { eventId: seeded.eventId, householdId: sargsyan.id, firstName: 'Lilit', lastName: 'Sargsyan',
      email: 'lilit@guests.test', token: 'journey04lilitlink' } });
    const link = (token: string) => guestBase(seeded.slug, token);
    return { ...seeded, endsAt, anna, davit, lilit, annaLink: link(anna.token), davitLink: link(davit.token), lilitLink: link(lilit.token) };
  };
  type Wedding = Awaited<ReturnType<typeof seedWedding>>;

  const uploadPhoto = async (base: string, caption: string) => {
    const { body } = await http().post(`${base}/gallery`).field('caption', caption)
      .attach('file', await drawing(), { filename: 'photo.png', contentType: 'image/png' }).expect(201);
    expect(body).toMatchObject({ kind: 'GALLERY', processingStatus: 'QUEUED', moderationStatus: 'PENDING', caption });
    return body as Media;
  };
  const guestGallery = async (base: string) => ((await http().get(`${base}/gallery`).expect(200)).body as { items: Media[] }).items;
  const hostGallery = async (w: Wedding, authorization: string) =>
    ((await http().get(api(`/events/${w.eventId}/gallery`)).set('Authorization', authorization).expect(200)).body as { items: Media[] }).items;
  const captions = (items: Media[]) => items.map((item) => item.caption).sort();
  const checkIn = (w: Wedding, guestId: string, authorization: string) =>
    http().post(api(`/events/${w.eventId}/guests/${guestId}/check-in`)).set('Authorization', authorization);

  /** Steps 1–3: the statement, a representative typed signature for a household, a drawn one for another. */
  const acknowledge = async (w: Wedding, authorization: string) => {
    const { body: question } = await http().post(api(`/invitations/${w.slug}/questions`)).set('Authorization', authorization)
      .send({ type: 'SIGNATURE', prompt: { en: 'I will follow the venue rules.' }, required: true }).expect(201);
    const published = await http().post(api(`/invitations/${w.slug}/publish`)).set('Authorization', authorization).expect(201);
    const expiresAt = new Date(w.endsAt.getTime() + 90 * DAY_MS);
    expect(published.body).toMatchObject({ lifetimeDays: 90, lifetimeSource: 'FREE_DEFAULT', expiresAt: expiresAt.toISOString() });

    // Ticket and guest admission wait on the statement: Davit cannot be let in until someone signs for him.
    const refused = await checkIn(w, w.davit.id, authorization).expect(400);
    expect(refused.body.message).toMatch(/acknowledg/i);
    expect(await prisma.checkIn.count({ where: { guestId: w.davit.id } })).toBe(0);

    const version = String(question.statementVersionId);
    const household = await http().post(`${w.annaLink}/acknowledgements`)
      .send({ ...typed(version, w.anna.id), subjectGuestIds: [w.anna.id, w.davit.id], signerName: 'Anna Petrosyan', isRepresentative: true }).expect(201);
    const signed = household.body.records as { subjectGuestId: string; signerGuestId: string; signerName: string }[];
    expect(signed.map((r) => r.subjectGuestId).sort()).toEqual([w.anna.id, w.davit.id].sort());
    expect(signed.every((r) => r.signerGuestId === w.anna.id && r.signerName === 'Anna Petrosyan')).toBe(true);
    // Davit sees, through his own link, the record his sister signed for him.
    const seenByDavit = await http().get(`${w.davitLink}/acknowledgements`).expect(200);
    expect(seenByDavit.body.records).toEqual(expect.arrayContaining([expect.objectContaining({ subjectGuestId: w.davit.id, signerGuestId: w.anna.id, isRepresentative: true })]));
    const admitted = await checkIn(w, w.davit.id, authorization).expect(201);
    expect(admitted.body).toMatchObject({ guestId: w.davit.id, arrivedAt: expect.any(String) });

    const { body: upload } = await http().post(`${w.lilitLink}/signature-uploads`).attach('file', await drawing(), { filename: 'signature.png', contentType: 'image/png' }).expect(201);
    expect(upload).toMatchObject({ kind: 'SIGNATURE', processingStatus: 'QUEUED' });
    await http().get(`${w.lilitLink}/signature-uploads/${String(upload.id)}/file`).expect(404);
    expect(await runMediaWorker()).toBe(1);
    const preview = await http().get(`${w.lilitLink}/signature-uploads/${String(upload.id)}/file`).expect(200);
    expect((preview.body as Buffer).subarray(0, 8)).toEqual(PNG_SIGNATURE);
    const drawnRecord = await http().post(`${w.lilitLink}/acknowledgements`)
      .send({ ...drawn(version, w.lilit.id, String(upload.id)), signerName: 'Lilit Sargsyan' }).expect(201);
    // Lilit's household is not Anna's: her drawing stays out of Anna's history and file reads.
    const lilitRecordId = String(drawnRecord.body.records[0].id);
    await http().get(`${w.annaLink}/acknowledgements/${lilitRecordId}/file`).expect(404);
    expect((await http().get(`${w.annaLink}/acknowledgements`).expect(200)).body.records).toHaveLength(2);
    return { expiresAt, signatureId: String(upload.id), lilitRecordId };
  };

  /** Steps 4–6: private processing, moderation before others see a photo, owner removal down to the stored bytes. */
  const shareAndModerate = async (w: Wedding, authorization: string) => {
    const dance = await uploadPhoto(w.davitLink, 'First dance');
    const toast = await uploadPhoto(w.lilitLink, 'Blurry toast');
    const cake = await uploadPhoto(w.annaLink, 'The cake');
    expect(await runMediaWorker()).toBe(3);
    const queue = await hostGallery(w, authorization);
    expect(queue.map((item) => [item.caption, item.processingStatus, item.moderationStatus]).sort())
      .toEqual([['Blurry toast', 'READY', 'PENDING'], ['First dance', 'READY', 'PENDING'], ['The cake', 'READY', 'PENDING']]);
    // Pending: each uploader sees only their own; nobody else can list or fetch it.
    expect(captions(await guestGallery(w.lilitLink))).toEqual(['Blurry toast']);
    await http().get(`${w.lilitLink}/gallery/${dance.id}/file?variant=thumbnail`).expect(404);

    const approve = (id: string, moderationStatus: string) => http().patch(api(`/events/${w.eventId}/gallery/${id}`))
      .set('Authorization', authorization).send({ moderationStatus }).expect(200);
    expect((await approve(dance.id, 'APPROVED')).body.moderationStatus).toBe('APPROVED');
    expect((await approve(toast.id, 'REJECTED')).body.moderationStatus).toBe('REJECTED');
    const lilitView = await guestGallery(w.lilitLink);
    expect(lilitView.map((item) => [item.caption, item.moderationStatus, item.isOwn]).sort())
      .toEqual([['Blurry toast', 'REJECTED', true], ['First dance', 'APPROVED', false]]);
    expect(captions(await guestGallery(w.annaLink))).toEqual(['First dance', 'The cake']);
    const thumbnail = await http().get(`${w.lilitLink}/gallery/${dance.id}/file?variant=thumbnail`).expect(200);
    expect(thumbnail.headers['content-type']).toContain('image/webp');
    await http().get(`${w.annaLink}/gallery/${toast.id}/file`).expect(404);

    // Davit takes his approved photo down: revoked at once, physically gone after cleanup.
    const ledger = await prisma.guestMedia.findUniqueOrThrow({ where: { id: dance.id } });
    await http().delete(`${w.lilitLink}/gallery/${dance.id}`).expect(404);
    await http().delete(`${w.davitLink}/gallery/${dance.id}`).expect(200);
    expect(captions(await guestGallery(w.lilitLink))).toEqual(['Blurry toast']);
    expect(captions(await hostGallery(w, authorization))).toEqual(['Blurry toast', 'The cake']);
    await http().get(api(`/events/${w.eventId}/gallery/${dance.id}/file`)).set('Authorization', authorization).expect(404);
    await expect(storedFile(ledger.sourceKey)).resolves.toBeInstanceOf(Buffer);
    await cleanupMedia();
    for (const key of [ledger.sourceKey, ledger.displayKey!, ledger.thumbnailKey!]) await expect(storedFile(key)).rejects.toThrow();
    return { toast, cake };
  };

  /** Step 8, guest side: once the captured deadline passes every contribution read and write is closed. */
  const expectGuestContributionsClosed = async (w: Wedding, photos: { toast: Media; cake: Media }, signatureId: string) => {
    for (const path of ['/acknowledgements', '/gallery', `/gallery/${photos.cake.id}/file`, `/signature-uploads/${signatureId}/file`]) {
      await http().get(`${w.lilitLink}${path}`).expect(404);
      await http().get(`${w.annaLink}${path}`).expect(404);
    }
    await http().post(`${w.annaLink}/gallery`).attach('file', await drawing(), { filename: 'late.png', contentType: 'image/png' }).expect(404);
    await http().post(`${w.annaLink}/signature-uploads`).attach('file', await drawing(), { filename: 'late.png', contentType: 'image/png' }).expect(404);
    await http().delete(`${w.annaLink}/gallery/${photos.cake.id}`).expect(404);
    await http().delete(`${w.lilitLink}/gallery/${photos.toast.id}`).expect(404);
  };

  /** The host's privacy officer assembles Lilit's subject-access export over HTTP. */
  const exportForLilit = async () => {
    const officer = await authenticateAs(app, prisma);
    await prisma.user.update({ where: { id: officer.userId }, data: { platformRole: PlatformRole.ADMIN } });
    await http().post(api('/privacy/requests')).send({ kind: 'EXPORT', subjectEmail: 'lilit@guests.test' }).expect(201);
    const { body: open } = await http().get(api('/privacy/requests')).set('Authorization', officer.authorization).expect(200);
    const requestId = String((open as { id: string; subjectEmail: string }[]).find((r) => r.subjectEmail === 'lilit@guests.test')!.id);
    await http().patch(api(`/privacy/requests/${requestId}`)).set('Authorization', officer.authorization).send({ status: 'IN_PROGRESS' }).expect(200);
    const { body } = await http().post(api(`/privacy/requests/${requestId}/fulfil`)).set('Authorization', officer.authorization).expect(201);
    const file = (mediaId: string) => http().get(api(`/privacy/requests/${requestId}/guest-media/${mediaId}/file`)).set('Authorization', officer.authorization);
    return { contributions: body.contributions as { acknowledgements: { id: string }[]; media: { id: string; kind: string }[] }, file };
  };

  /** Step 8, the boundary: still open a moment before the captured deadline, closed from that instant on, and swept once. */
  const passDeadline = async (w: Wedding, expiresAt: Date, photos: { toast: Media; cake: Media }, signatureId: string) => {
    const maintenance = app.get(InvitationMaintenanceService);
    // The event happens; ninety days later the clock stands one millisecond short of the deadline captured at publication.
    jest.useFakeTimers({ now: new Date(expiresAt.getTime() - 1), doNotFake: [...REAL_TIMERS] });
    expect(captions(await guestGallery(w.annaLink))).toEqual(['The cake']);
    expect((await maintenance.maintain()).expiriesProcessed).toBe(0);
    jest.setSystemTime(expiresAt);
    await expectGuestContributionsClosed(w, photos, signatureId);
    expect((await maintenance.maintain()).expiriesProcessed).toBe(1);
    const invitation = await prisma.invitation.findUniqueOrThrow({ where: { slug: w.slug } });
    expect(invitation.expiryProcessedAt).not.toBeNull();
    expect(invitation.expiresAt).toEqual(expiresAt);
    expect((await maintenance.maintain()).expiriesProcessed).toBe(0);
  };

  /** After expiry the host still reads every signature record and the drawn file behind one. */
  const expectHostKeepsSignatures = async (w: Wedding, authorization: string, expiresAt: Date, lilitRecordId: string) => {
    const event = await http().get(api(`/events/${w.eventId}`)).set('Authorization', authorization).expect(200);
    expect(event.body.invitation).toMatchObject({ isExpired: true, expiresAt: expiresAt.toISOString() });
    const records = await http().get(api(`/events/${w.eventId}/acknowledgements`)).set('Authorization', authorization).expect(200);
    const held = records.body.items as { subjectGuestId: string; signerGuestId: string; method: string }[];
    expect(held.map((r) => [r.subjectGuestId, r.signerGuestId, r.method]).sort())
      .toEqual([[w.anna.id, w.anna.id, 'TYPED'], [w.davit.id, w.anna.id, 'TYPED'], [w.lilit.id, w.lilit.id, 'DRAWN']].sort());
    const drawnFile = await http().get(api(`/events/${w.eventId}/acknowledgements/${lilitRecordId}/file`)).set('Authorization', authorization).expect(200);
    expect((drawnFile.body as Buffer).subarray(0, 8)).toEqual(PNG_SIGNATURE);
  };

  /** After expiry the host still moderates: approves the cake, views it, and takes the rejected toast down to the bytes. */
  const moderateAfterExpiry = async (w: Wedding, authorization: string, photos: { toast: Media; cake: Media }) => {
    const cake = await http().patch(api(`/events/${w.eventId}/gallery/${photos.cake.id}`)).set('Authorization', authorization).send({ moderationStatus: 'APPROVED' }).expect(200);
    expect(cake.body).toMatchObject({ moderationStatus: 'APPROVED', moderatedAt: expect.any(String) });
    const display = await http().get(api(`/events/${w.eventId}/gallery/${photos.cake.id}/file`)).set('Authorization', authorization).expect(200);
    expect(display.headers['content-type']).toContain('image/webp');
    const toastLedger = await prisma.guestMedia.findUniqueOrThrow({ where: { id: photos.toast.id } });
    await http().delete(api(`/events/${w.eventId}/gallery/${photos.toast.id}`)).set('Authorization', authorization).expect(200);
    expect((await hostGallery(w, authorization)).map((item) => [item.caption, item.moderationStatus])).toEqual([['The cake', 'APPROVED']]);
    await expect(storedFile(toastLedger.sourceKey)).resolves.toBeInstanceOf(Buffer);
    await cleanupMedia();
    await expect(storedFile(toastLedger.sourceKey)).rejects.toThrow();
  };

  it('keeps signatures and moderated photos with the host after expiry, closes them to guests at the deadline and drops removed photos from exports', async () => {
    const w = await seedWedding();
    const firstSession = await signIn();
    const { expiresAt, signatureId, lilitRecordId } = await acknowledge(w, firstSession);
    const photos = await shareAndModerate(w, firstSession);
    await passDeadline(w, expiresAt, photos, signatureId);

    // The host's old session has lapsed with the months; she signs in again and finds everything.
    await http().get(api(`/events/${w.eventId}`)).set('Authorization', firstSession).expect(401);
    const authorization = await signIn();
    await expectHostKeepsSignatures(w, authorization, expiresAt, lilitRecordId);

    // Lilit's subject-access export after expiry carries her drawing, her record and her rejected photo...
    const dsar = await exportForLilit();
    expect(dsar.contributions.acknowledgements.map((r) => r.id)).toEqual([lilitRecordId]);
    expect(dsar.contributions.media.map((m) => [m.id, m.kind]).sort()).toEqual([[photos.toast.id, 'GALLERY'], [signatureId, 'SIGNATURE']].sort());
    await dsar.file(photos.toast.id).expect(200);
    // ...until the host removes that photo: then the export no longer serves it, while the drawing stays.
    await moderateAfterExpiry(w, authorization, photos);
    await dsar.file(photos.toast.id).expect(404);
    await dsar.file(signatureId).expect(200);
    expect(await prisma.guest.count({ where: { eventId: w.eventId } })).toBe(3);
    expect(await prisma.guestAcknowledgement.count({ where: { eventId: w.eventId } })).toBe(3);

    // The host's guest list still downloads after expiry and carries no photo content.
    const { body: exported } = await http().post(api(`/events/${w.eventId}/exports`)).set('Authorization', authorization).send({ kind: 'GUEST_LIST' }).expect(201);
    const csv = await http().get(api(`/events/${w.eventId}/exports/${String(exported.id)}/download`)).set('Authorization', authorization).expect(200);
    expect(parseCsv(csv.text)).toHaveLength(3);
    expect(csv.text).not.toMatch(/The cake|Blurry toast|First dance/);
  });
});
