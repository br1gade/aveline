import { ThrottlerStorage } from '@nestjs/throttler';
import { UNTHROTTLED } from '../../fixtures/unthrottled.fixture';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { BlockType, MessageChannel, MessageStatus, PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { SerializeInterceptor } from '../../../src/common/interceptors/serialize';
import { MessageTransport } from '../../../src/modules/communications/channels/message-channel';
import { SmtpTransport } from '../../../src/modules/communications/channels/smtp.transport';
import { MESSAGE_TRANSPORTS } from '../../../src/modules/communications/communications.module';
import { CommunicationsService } from '../../../src/modules/communications/communications.service';
import { ExportRunner } from '../../../src/modules/exports/export-runner';
import { PrivateMediaRunner } from '../../../src/modules/guest-contributions/private-media-runner';
import { InvitationMaintenanceService } from '../../../src/modules/invitations/invitation-maintenance.service';
import { SeatingRunner } from '../../../src/modules/seating/jobs/seating-runner';
import { buildPrivateStorage, PRIVATE_STORAGE, PrivateStorageService } from '../../../src/infra/storage/private/private-storage';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { MESSAGE_COPY } from '../../../src/seed/message-copy';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** What a fresh deployment seeds: the classic template and Aveline's message copy. */
async function seedPlatformDefaults(prisma: PrismaClient): Promise<void> {
  await prisma.designTemplate.upsert({
    where: { key: 'classic' },
    update: {},
    create: {
      key: 'classic', name: 'Classic', allowedFonts: ['Noto Serif Armenian', 'Inter'],
      palettes: [{ name: 'ivory-gold', colors: ['#fffaf0', '#b8860b'] }],
      supportedBlocks: [BlockType.HERO, BlockType.VENUE, BlockType.NOTES, BlockType.RSVP],
      blockVariants: { HERO: ['full-bleed', 'split'], RSVP: ['split', 'stacked'] },
      defaultTheme: { bodyFont: 'Noto Serif Armenian', palette: 'ivory-gold' },
    },
  });
  await prisma.messageTemplate.createMany({ data: MESSAGE_COPY.map((template) => ({ ...template, organizationId: null })) });
}

/** Reads an exported CSV the way a spreadsheet would: BOM stripped, CRLF rows, quoted cells. */
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^\uFEFF/, '').split('\r\n').filter((line) => line.length > 0);
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

/** The personal link a sent message carries. */
function linkIn(body: string): string {
  const match = /\/invitations\/([^/\s]+)\/g\/([^/\s]+)/.exec(body);
  if (!match) throw new Error(`No personal link in message: ${body}`);
  return `/api/v1/invitations/${match[1]}/g/${match[2]}`;
}

const binary = (response: request.Response, done: (error: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.on('end', () => done(null, Buffer.concat(chunks)));
};

/**
 * Journey 10: an invitation's guest lifetime runs out, and the host keeps
 * everything. Only HTTP, the in-process workers and the maintenance sweep
 * move the story; the passage of time is the host correcting the event dates,
 * which is the same path a real date change takes.
 *
 *   Petrosyan (2 seats): Armen answers and signs for himself and Lusine.
 *   Sargsyan (1 seat): Mariam answers, signs and shares a photo.
 *   Hakobyan (1 seat): Tigran never answers — and is too late once it closes.
 *   Ani, added late: her invitation is queued but not out before expiry.
 */
describe('Journey 10: event lifetime expiry closes guest access and keeps host data (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let root: string;
  const http = () => request(app.getHttpServer() as Server);
  const api = (path: string) => `/api/v1${path}`;

  beforeAll(async () => {
    prisma = testPrisma();
    root = await mkdtemp(join(tmpdir(), 'aveline-journey-10-'));
    const storage = buildPrivateStorage(new ConfigService({ S3_ENDPOINT: '', STORAGE_ROOT: join(root, 'public'), PRIVATE_STORAGE_ROOT: join(root, 'private') }));
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(prisma).overrideProvider(ThrottlerStorage).useValue(UNTHROTTLED)
      .overrideProvider(PRIVATE_STORAGE).useValue(storage)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalInterceptors(new SerializeInterceptor());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    // Every worker and sweep is driven in-process; a wall-clock cron would race the counts.
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) await job.stop();
  });

  beforeEach(async () => {
    await resetTestDatabase();
    await seedPlatformDefaults(prisma);
  });

  afterAll(async () => {
    const email = app.get<Map<MessageChannel, MessageTransport>>(MESSAGE_TRANSPORTS).get(MessageChannel.EMAIL);
    if (email instanceof SmtpTransport) email.close();
    await app.close();
    await rm(root, { recursive: true, force: true });
    await disconnectTestDatabase();
  });

  const registerHost = async () => {
    const email = `host-${randomUUID().slice(0, 8)}@journey.test`;
    const password = 'a-long-enough-journey-password';
    await http().post(api('/auth/register')).send({ email, password, name: 'Anna Host' }).expect(202);
    const { body: session } = await http().post(api('/auth/login')).send({ email, password }).expect(201);
    const authorization = `Bearer ${session.accessToken as string}`;
    await http().post(api('/organizations')).set('Authorization', authorization).send({ name: 'Anna & Davit', kind: 'HOST' }).expect(201);
    return authorization;
  };

  /** Moves the event, as a host correcting its dates does; returns the host's view of the invitation. */
  const moveEvent = async (authorization: string, eventId: string, dates: { startsAt: Date; endsAt?: Date | null }) => {
    const { body } = await http().patch(api(`/events/${eventId}`)).set('Authorization', authorization).send({
      startsAt: dates.startsAt.toISOString(),
      ...(dates.endsAt === undefined ? {} : { endsAt: dates.endsAt === null ? null : dates.endsAt.toISOString() }),
    }).expect(200);
    return body.invitation as { status: string; expiresAt: string | null; isExpired: boolean; lifetimeDays: number | null };
  };

  const GUEST_CSV = [
    'First name,Last name,Email,Household,Seats,Locale',
    'Armen,Petrosyan,armen@journey.test,Petrosyan,2,en',
    'Lusine,Petrosyan,,Petrosyan,2,en',
    'Mariam,Sargsyan,mariam@journey.test,Sargsyan,1,en',
    'Tigran,Hakobyan,tigran@journey.test,Hakobyan,1,en',
  ].join('\n');

  interface Ids { eventId: string; slug: string; venueId: string; questionId: string; statementVersionId: string; endsAt: Date }

  /** Event, room, a required signed statement and the guest list; then publish. */
  const createAndPublish = async (authorization: string): Promise<Ids> => {
    const as = <T extends request.Test>(call: T) => call.set('Authorization', authorization);
    const startsAt = new Date(Date.now() + 10 * DAY_MS);
    const endsAt = new Date(startsAt.getTime() + 6 * HOUR_MS);
    const { body: event } = await as(http().post(api('/events'))).send({
      type: 'WEDDING', title: 'Anna & Davit', templateKey: 'classic',
      startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), locales: ['en'], defaultLocale: 'en',
    }).expect(201);
    const eventId = event.id as string; const slug = event.invitation.slug as string;
    const { body: venue } = await as(http().post(api(`/events/${eventId}/venues`)))
      .send({ role: 'RECEPTION', name: 'Ararat Hall', address: '1 Abovyan St, Yerevan', capacity: 60 }).expect(201);
    await as(http().post(api(`/events/${eventId}/tables/bulk`))).send({ venueId: venue.id, namePrefix: 'Table', count: 2, capacity: 4 }).expect(201);
    const { body: statement } = await as(http().post(api(`/invitations/${slug}/questions`)))
      .send({ type: 'SIGNATURE', required: true, prompt: { en: 'I accept the venue rules.' } }).expect(201);
    const { body: imported } = await as(http().post(api(`/events/${eventId}/guests/import`)))
      .attach('file', Buffer.from(GUEST_CSV), { filename: 'guests.csv', contentType: 'text/csv' }).expect(201);
    expect(imported).toMatchObject({ status: 'COMPLETED', rowsImported: 4, rowsFailed: 0 });

    const { body: published } = await as(http().post(api(`/invitations/${slug}/publish`))).expect(201);
    // Free fallback: ninety days after the event ends.
    expect(published).toMatchObject({ lifetimeSource: 'FREE_DEFAULT', lifetimeDays: 90, expiresAt: new Date(endsAt.getTime() + 90 * DAY_MS).toISOString() });
    return { eventId, slug, venueId: venue.id as string, questionId: statement.id as string, statementVersionId: statement.statementVersionId as string, endsAt };
  };

  const linkFor = async (eventId: string, toAddress: string) => {
    const message = await prisma.message.findFirstOrThrow({ where: { eventId, templateKey: 'invitation.send', toAddress }, select: { body: true } });
    return linkIn(message.body);
  };

  const signed = (signerName: string) => ({ method: 'TYPED', signerName, isAcknowledged: true, locale: 'en' });

  /** Guests answer and sign through the links they were sent; Mariam shares a photo. */
  const guestsTakePart = async (authorization: string, ids: Ids) => {
    const { body: sent } = await http().post(api(`/invitations/${ids.slug}/send`)).set('Authorization', authorization).send({}).expect(201);
    expect(sent.queued).toBe(3);
    expect(await app.get(CommunicationsService).dispatchDue()).toMatchObject({ sent: 3, failed: 0 });

    const armen = await linkFor(ids.eventId, 'armen@journey.test');
    const { body: form } = await http().get(`${armen}/rsvp`).expect(200);
    const lusine = (form.household.members as { id: string; firstName: string }[]).find((member) => member.firstName === 'Lusine')!;
    const statement = { ...signed('Armen Petrosyan'), statementVersionId: ids.statementVersionId };
    await http().post(`${armen}/rsvp`).send({
      status: 'ATTENDING', answers: [{ questionId: ids.questionId, value: statement }],
      members: [{ guestId: lusine.id, status: 'ATTENDING', answers: [{ questionId: ids.questionId, value: { ...statement, isRepresentative: true } }] }],
    }).expect(201);

    const mariam = await linkFor(ids.eventId, 'mariam@journey.test');
    await http().post(`${mariam}/rsvp`).send({
      status: 'ATTENDING', answers: [{ questionId: ids.questionId, value: { ...signed('Mariam Sargsyan'), statementVersionId: ids.statementVersionId } }],
    }).expect(201);
    const photo = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#b76e79' } }).png().toBuffer();
    const { body: upload } = await http().post(`${mariam}/gallery`).field('caption', 'First dance')
      .attach('file', photo, { filename: 'dance.png', contentType: 'image/png' }).expect(201);
    expect(await new PrivateMediaRunner(prisma as unknown as PrismaService, app.get(PrivateStorageService)).runOne()).toBe(true);
    await http().patch(api(`/events/${ids.eventId}/gallery/${upload.id as string}`)).set('Authorization', authorization)
      .send({ moderationStatus: 'APPROVED' }).expect(200);
    // Approved, so another household's link shows it.
    const { body: seenByArmen } = await http().get(`${armen}/gallery`).expect(200);
    expect(seenByArmen.items).toEqual([expect.objectContaining({ id: upload.id, isOwn: false, caption: 'First dance', processingStatus: 'READY', moderationStatus: 'APPROVED' })]);
    await http().get(`${armen}/gallery/${upload.id as string}/file`).expect(200);
    return { armen, mariam, tigran: await linkFor(ids.eventId, 'tigran@journey.test'), photoId: upload.id as string };
  };

  /** The real seating job, then the plan published to guests. */
  const autoSeat = async (authorization: string, ids: Ids) => {
    const { body: arrangements } = await http().get(api(`/events/${ids.eventId}/seating/arrangements`)).set('Authorization', authorization).expect(200);
    const hall = (arrangements as { id: string; venueId: string | null }[]).find((arrangement) => arrangement.venueId === ids.venueId)!;
    const { body: job } = await http().post(api(`/events/${ids.eventId}/seats/auto-assign?arrangementId=${hall.id}`))
      .set('Authorization', authorization).send({ idempotencyKey: randomUUID() }).expect(201);
    expect(await app.get(SeatingRunner).runOne()).toBe(true);
    const { body: done } = await http().get(api(`/events/${ids.eventId}/seating/jobs/${job.id as string}`)).set('Authorization', authorization).expect(200);
    expect(done).toMatchObject({ status: 'COMPLETED', result: { seated: 3, households: 2, unseated: [] } });
    await http().post(api(`/events/${ids.eventId}/seating/publish`)).set('Authorization', authorization).expect(201);
    return `/events/${ids.eventId}/tables?arrangementId=${hall.id}`;
  };

  const seatedNames = (tables: { guests: { name: string }[] }[]) => tables.flatMap((table) => table.guests.map((guest) => guest.name)).sort();

  /** A queued guest-list snapshot, built by the worker, downloaded as CSV. */
  const snapshot = async (authorization: string, eventId: string) => {
    const base = api(`/events/${eventId}/export-snapshots`);
    const { body: created } = await http().post(base).set('Authorization', authorization)
      .send({ kind: 'GUEST_LIST', format: 'CSV', locale: 'en', idempotencyKey: randomUUID() }).expect(201);
    expect(await app.get(ExportRunner).runOne()).toBe(true);
    const download = () => http().get(`${base}/${created.id as string}/download`).set('Authorization', authorization).buffer(true).parse(binary).expect(200);
    const bytes = (await download()).body as Buffer;
    return { id: created.id as string, bytes, rows: parseCsv(bytes.toString('utf8')), download };
  };

  /** What the host sees: answers, seating, signatures and photos. */
  const hostView = async (authorization: string, ids: Ids, tablesPath: string) => {
    const get = async (path: string) => (await http().get(api(path)).set('Authorization', authorization).expect(200)).body as Record<string, unknown>;
    const dashboard = await get(`/events/${ids.eventId}/dashboard`);
    const households = (await http().get(api(`/events/${ids.eventId}/guests`)).set('Authorization', authorization).expect(200)).body as { name: string }[];
    const tables = (await http().get(api(tablesPath)).set('Authorization', authorization).expect(200)).body as { guests: { name: string }[] }[];
    const acknowledgements = await get(`/events/${ids.eventId}/acknowledgements`);
    const gallery = await get(`/events/${ids.eventId}/gallery`);
    return { headcount: dashboard.headcount, households: households.map((household) => household.name).sort(), seated: seatedNames(tables),
      acknowledgements: (acknowledgements.items as unknown[]).length, gallery: gallery.items as { id: string; moderationStatus: string }[] };
  };

  it('closes every guest surface after the dated expiry and sweep, while the host keeps answers, seating, signatures, photos and snapshots', async () => {
    const authorization = await registerHost();
    const ids = await createAndPublish(authorization);
    const links = await guestsTakePart(authorization, ids);
    const tablesPath = await autoSeat(authorization, ids);
    const earlier = await snapshot(authorization, ids.eventId);
    expect(earlier.rows.map((row) => [row['First name'], row.RSVP])).toEqual(expect.arrayContaining([
      ['Armen', 'ATTENDING'], ['Lusine', 'ATTENDING'], ['Mariam', 'ATTENDING'], ['Tigran', 'PENDING'],
    ]));
    const before = await hostView(authorization, ids, tablesPath);
    expect(before).toMatchObject({ households: ['Hakobyan', 'Petrosyan', 'Sargsyan'], seated: ['Armen Petrosyan', 'Lusine Petrosyan', 'Mariam Sargsyan'], acknowledgements: 3 });
    expect(before.headcount).toMatchObject({ attending: 3, pending: 1 });

    // Tigran has had his invitation for four days and still not answered: the host chases him.
    await prisma.message.updateMany({ where: { eventId: ids.eventId, templateKey: 'invitation.send', toAddress: 'tigran@journey.test' }, data: { createdAt: new Date(Date.now() - 4 * DAY_MS) } });
    const { body: reminded } = await http().post(api(`/invitations/${ids.slug}/remind`)).set('Authorization', authorization).send({}).expect(201);
    expect(reminded).toMatchObject({ queued: 1, recipients: [expect.objectContaining({ toAddress: 'tigran@journey.test' })] });

    // The wedding happens: the host records that it was two days ago. Guests keep ninety days.
    const happenedAt = new Date(Date.now() - 2 * DAY_MS);
    const afterParty = await moveEvent(authorization, ids.eventId, { startsAt: happenedAt, endsAt: new Date(happenedAt.getTime() + 6 * HOUR_MS) });
    expect(afterParty).toMatchObject({ isExpired: false, expiresAt: new Date(happenedAt.getTime() + 6 * HOUR_MS + 90 * DAY_MS).toISOString() });
    const maintenance = app.get(InvitationMaintenanceService);
    expect(await maintenance.maintain()).toMatchObject({ expiriesProcessed: 0 });
    // Past the event but inside the lifetime, every guest surface still answers.
    await http().get(links.armen).expect(200);
    await http().get(`${links.tigran}/rsvp`).expect(200);
    await http().get(`${links.mariam}/gallery`).expect(200);
    await http().get(`${links.armen}/gallery/${links.photoId}/file`).expect(200);
    await http().get(`${links.armen}/acknowledgements`).expect(200);

    // A late addition is invited, but her email is still in the outbox when access closes.
    await http().post(api(`/events/${ids.eventId}/guests`)).set('Authorization', authorization)
      .send({ firstName: 'Ani', lastName: 'Avetisyan', email: 'ani@journey.test', locale: 'en' }).expect(201);
    expect((await http().post(api(`/invitations/${ids.slug}/send`)).set('Authorization', authorization).send({}).expect(201)).body.queued).toBe(1);

    // Ninety-two days on: the correction that puts the end beyond the lifetime closes guest access.
    const longAgo = new Date(Date.now() - 92 * DAY_MS);
    const expired = await moveEvent(authorization, ids.eventId, { startsAt: longAgo, endsAt: new Date(longAgo.getTime() + 6 * HOUR_MS) });
    expect(expired).toMatchObject({ status: 'PUBLISHED', isExpired: true, lifetimeDays: 90, expiresAt: new Date(longAgo.getTime() + 6 * HOUR_MS + 90 * DAY_MS).toISOString() });
    expect(await maintenance.maintain()).toMatchObject({ expiriesProcessed: 1 });
    expect(await maintenance.maintain()).toMatchObject({ expiriesProcessed: 0 });
    expect(await prisma.invitation.findUniqueOrThrow({ where: { slug: ids.slug } })).toMatchObject({ status: 'PUBLISHED', expiryProcessedAt: expect.any(Date) });

    // Every guest surface is closed: pages, forms, answers, names, gallery and signatures.
    await http().get(links.armen).expect(404);
    await http().get(`${links.tigran}/rsvp`).expect(404);
    const late = await http().post(`${links.tigran}/rsvp`).send({ status: 'ATTENDING', answers: [{ questionId: ids.questionId, value: { ...signed('Tigran Hakobyan'), statementVersionId: ids.statementVersionId } }] }).expect(400);
    expect(late.body.message).toBe('This invitation has closed');
    await http().patch(`${links.tigran}/name`).send({ firstName: 'Tiko' }).expect(404);
    await http().get(`${links.mariam}/gallery`).expect(404);
    await http().get(`${links.armen}/gallery/${links.photoId}/file`).expect(404);
    await http().get(`${links.armen}/acknowledgements`).expect(404);
    const photo = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000000' } }).png().toBuffer();
    await http().post(`${links.mariam}/gallery`).attach('file', photo, { filename: 'late.png', contentType: 'image/png' }).expect(404);
    expect(await prisma.rsvp.findFirstOrThrow({ where: { guest: { eventId: ids.eventId, firstName: 'Tigran' } } })).toMatchObject({ status: 'PENDING' });
    expect(await prisma.guestMedia.count({ where: { eventId: ids.eventId } })).toBe(1);
    expect(await prisma.guest.count({ where: { eventId: ids.eventId, firstName: { in: ['Tigran', 'Tiko'] } } })).toBe(1);
    expect(await prisma.guest.count({ where: { eventId: ids.eventId, firstName: 'Tiko' } })).toBe(0);

    // No dead link goes out: what was queued before expiry is cancelled at dispatch, and new sends and reminders are refused.
    const queuedBeforeExpiry = () => prisma.message.findMany({
      where: { eventId: ids.eventId, OR: [{ toAddress: 'ani@journey.test' }, { templateKey: 'rsvp.reminder' }] },
      select: { templateKey: true, toAddress: true, status: true, failureReason: true }, orderBy: { toAddress: 'asc' },
    });
    expect((await queuedBeforeExpiry()).map((message) => [message.templateKey, message.toAddress, message.status])).toEqual([
      ['invitation.send', 'ani@journey.test', MessageStatus.QUEUED], ['rsvp.reminder', 'tigran@journey.test', MessageStatus.QUEUED],
    ]);
    await app.get(CommunicationsService).dispatchDue();
    expect(await queuedBeforeExpiry()).toEqual([
      { templateKey: 'invitation.send', toAddress: 'ani@journey.test', status: MessageStatus.CANCELLED, failureReason: 'No longer applied when it was due to be sent' },
      { templateKey: 'rsvp.reminder', toAddress: 'tigran@journey.test', status: MessageStatus.CANCELLED, failureReason: 'No longer applied when it was due to be sent' },
    ]);
    const resend = await http().post(api(`/invitations/${ids.slug}/send`)).set('Authorization', authorization).send({}).expect(400);
    expect(resend.body.message).toBe('This invitation has expired');
    const remindAgain = await http().post(api(`/invitations/${ids.slug}/remind`)).set('Authorization', authorization).send({}).expect(400);
    expect(remindAgain.body.message).toBe('This invitation has expired');
    expect(await prisma.message.count({ where: { eventId: ids.eventId, templateKey: { in: ['invitation.send', 'rsvp.reminder'] }, status: MessageStatus.SENT } })).toBe(3);

    // The host keeps all of it: the event is not archived and nothing was deleted.
    const { body: event } = await http().get(api(`/events/${ids.eventId}`)).set('Authorization', authorization).expect(200);
    expect(event.status).not.toBe('ARCHIVED');
    expect(event.invitation).toMatchObject({ status: 'PUBLISHED', isExpired: true });
    const after = await hostView(authorization, ids, tablesPath);
    // Ani joined the list and is still undecided; every earlier answer is untouched.
    expect(after).toEqual({ ...before, headcount: expect.anything(), households: [...before.households, 'Ani Avetisyan'].sort() });
    expect(after.headcount).toMatchObject({ invited: 5, attending: 3, declined: 0, pending: 2 });
    expect(after.gallery).toEqual([expect.objectContaining({ id: links.photoId, moderationStatus: 'APPROVED' })]);
    const file = await http().get(api(`/events/${ids.eventId}/gallery/${links.photoId}/file`)).set('Authorization', authorization).buffer(true).parse(binary).expect(200);
    expect((file.body as Buffer).subarray(8, 12).toString('ascii')).toBe('WEBP');

    // The earlier snapshot is the same file, and a fresh one still carries every answer.
    expect(((await earlier.download()).body as Buffer).equals(earlier.bytes)).toBe(true);
    const fresh = await snapshot(authorization, ids.eventId);
    expect(fresh.rows.find((row) => row['First name'] === 'Armen')).toMatchObject({ RSVP: 'ATTENDING' });
    expect(fresh.rows.find((row) => row['First name'] === 'Ani')).toMatchObject({ RSVP: 'PENDING' });
  }, 120_000);

  it('captures expiry from the start when no end is set, follows each date edit, and rearms after the sweep when the host corrects the date', async () => {
    const authorization = await registerHost();
    const as = <T extends request.Test>(call: T) => call.set('Authorization', authorization);
    const startsAt = new Date(Date.now() + 20 * DAY_MS);
    const { body: created } = await as(http().post(api('/events'))).send({
      type: 'WEDDING', title: 'Start only', templateKey: 'classic', startsAt: startsAt.toISOString(), locales: ['en'], defaultLocale: 'en',
    }).expect(201);
    const eventId = created.id as string; const slug = created.invitation.slug as string;
    await as(http().post(api(`/events/${eventId}/venues`))).send({ role: 'RECEPTION', name: 'Ararat Hall', address: '1 Abovyan St, Yerevan', capacity: 60 }).expect(201);
    const { body: guest } = await as(http().post(api(`/events/${eventId}/guests`))).send({ firstName: 'Ani', email: 'ani@journey.test', locale: 'en' }).expect(201);
    const link = api(`/invitations/${slug}/g/${guest.token as string}`);
    const plus90 = (date: Date) => new Date(date.getTime() + 90 * DAY_MS).toISOString();

    expect((await as(http().post(api(`/invitations/${slug}/publish`))).expect(201)).body).toMatchObject({ expiresAt: plus90(startsAt), lifetimeDays: 90 });
    const endsAt = new Date(startsAt.getTime() + 2 * DAY_MS);
    expect(await moveEvent(authorization, eventId, { startsAt, endsAt })).toMatchObject({ expiresAt: plus90(endsAt) });
    expect(await moveEvent(authorization, eventId, { startsAt, endsAt: null })).toMatchObject({ expiresAt: plus90(startsAt) });

    // Entered with the wrong year: the start is more than ninety days ago, so access closes at once.
    const wrongYear = new Date(startsAt.getTime() - 365 * DAY_MS);
    expect(await moveEvent(authorization, eventId, { startsAt: wrongYear })).toMatchObject({ expiresAt: plus90(wrongYear), isExpired: true });
    expect(await app.get(InvitationMaintenanceService).maintain()).toMatchObject({ expiriesProcessed: 1 });
    await http().get(link).expect(404);

    // The host corrects it; the guest's link works again and a later lapse is swept afresh.
    expect(await moveEvent(authorization, eventId, { startsAt })).toMatchObject({ expiresAt: plus90(startsAt), isExpired: false });
    expect(await prisma.invitation.findUniqueOrThrow({ where: { slug } })).toMatchObject({ expiryProcessedAt: null });
    const { body: page } = await http().get(link).expect(200);
    expect(page.guest).toMatchObject({ name: 'Ani' });
    await http().post(`${link}/rsvp`).send({ status: 'ATTENDING' }).expect(201);
    expect((await http().get(api(`/events/${eventId}/dashboard`)).set('Authorization', authorization).expect(200)).body.headcount).toMatchObject({ attending: 1 });
    expect(await moveEvent(authorization, eventId, { startsAt: wrongYear })).toMatchObject({ isExpired: true });
    expect(await app.get(InvitationMaintenanceService).maintain()).toMatchObject({ expiriesProcessed: 1 });
    await http().get(link).expect(404);
  }, 60_000);
});
