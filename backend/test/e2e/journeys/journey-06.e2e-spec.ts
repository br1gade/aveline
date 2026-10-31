import { ThrottlerStorage } from '@nestjs/throttler';
import { UNTHROTTLED } from '../../fixtures/unthrottled.fixture';
import type { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { BlockType, EventType, MessageChannel, MessageStatus, PaymentProvider, PrismaClient } from '@prisma/client';
import request from 'supertest';
import sharp from 'sharp';
import { AppModule } from '../../../src/app.module';
import { SerializeInterceptor } from '../../../src/common/interceptors/serialize';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { STORAGE_ADAPTER } from '../../../src/infra/storage/storage-port';
import { FilesystemStorageAdapter } from '../../../src/infra/storage/adapters/filesystem.adapter';
import { buildPrivateStorage, PRIVATE_STORAGE, PrivateStorageService } from '../../../src/infra/storage/private/private-storage';
import { AuditService } from '../../../src/infra/audit/audit.service';
import { AnalyticsService } from '../../../src/infra/analytics/analytics.service';
import { MessageTransport } from '../../../src/modules/communications/channels/message-channel';
import { SmtpTransport } from '../../../src/modules/communications/channels/smtp.transport';
import { MESSAGE_TRANSPORTS } from '../../../src/modules/communications/communications.module';
import { CommunicationsService } from '../../../src/modules/communications/communications.service';
import { ExportRunner } from '../../../src/modules/exports/export-runner';
import { PrivateMediaRunner } from '../../../src/modules/guest-contributions/private-media-runner';
import { PaymentGatewayRegistry } from '../../../src/modules/payments/payment-gateway.registry';
import { FakeGateway } from '../../../src/modules/payments/providers/fake.gateway';
import { EnquiryJournal } from '../../../src/modules/sales/enquiry-journal';
import { MESSAGE_COPY } from '../../../src/seed/message-copy';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

const INTAKE_ENV = ['SALES_INTAKE_ENABLED', 'SALES_INTAKE_SUPPORT_ENABLED', 'SALES_INTENT_HMAC_KEY_ID', 'SALES_INTENT_HMAC_KEYS', 'SALES_PRIVACY_JOURNAL_DIR', 'SALES_PRIVACY_JOURNAL_KEY'];

/** The person who asks to be forgotten, written with capitals where she typed them. */
const ANI = 'ani@journey06.test';
const ANI_PHONE = '+37491000006';
const ANI_TELEGRAM_CHAT = 660066;
const ANI_DEVICE = 'apns-device-token-of-ani-0123456789';
const ANI_PASSWORD = 'a-long-enough-password-for-ani';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Reads an exported CSV the way a spreadsheet would: BOM stripped, CRLF
 * rows, every cell quoted with doubled quotes inside.
 */
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

/**
 * Journey 6: one person, everywhere, erased through the public DSAR flow.
 *
 * Ani is at once an invited guest who answers for herself and a named
 * plus-one, signs the event's statement for both, uploads a gallery photo,
 * connects Telegram, holds an account with a push device, buys paid tickets
 * for herself and a friend through the bank, appears in a stored export,
 * a vendor's brief, an Aveline sales enquiry and the outbox. Every one of
 * those is produced over HTTP, the workers run in-process as the scheduler
 * would, and then she files an erasure request with no account; Aveline
 * staff verify it, bind her enquiry, and fulfil it. Each module is then read
 * back the way its own audience reads it — the host, the vendor, the buyer
 * link, another guest, the door — to show what went and what deliberately
 * stayed. Last, the ERASED suppression keeps her out of re-import and
 * messaging.
 */
describe('Journey 6: DSAR erasure after a full event reaches every module (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let root: string;
  const previousPilotMode = process.env.PILOT_MODE;

  const http = () => request(app.getHttpServer() as Server);
  const APP_URL = process.env.PUBLIC_APP_URL ?? 'http://localhost:5173';

  beforeAll(async () => {
    process.env.PILOT_MODE = 'false';
    root = await mkdtemp(join(tmpdir(), 'aveline-journey-06-'));
    const journal = join(root, 'journal');
    await new EnquiryJournal(journal, 'j'.repeat(32)).initialize();
    Object.assign(process.env, {
      SALES_INTAKE_ENABLED: 'true', SALES_INTAKE_SUPPORT_ENABLED: 'true', SALES_INTENT_HMAC_KEY_ID: 'test',
      SALES_INTENT_HMAC_KEYS: JSON.stringify({ test: 'x'.repeat(32) }), SALES_PRIVACY_JOURNAL_DIR: journal, SALES_PRIVACY_JOURNAL_KEY: 'j'.repeat(32),
    });
    prisma = testPrisma();
    const privateStorage = buildPrivateStorage(new ConfigService({ S3_ENDPOINT: '', STORAGE_ROOT: join(root, 'public'), PRIVATE_STORAGE_ROOT: join(root, 'private') }));
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(prisma).overrideProvider(ThrottlerStorage).useValue(UNTHROTTLED)
      .overrideProvider(STORAGE_ADAPTER).useValue(new FilesystemStorageAdapter(join(root, 'public'), '/files'))
      .overrideProvider(PRIVATE_STORAGE).useValue(privateStorage)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalInterceptors(new SerializeInterceptor());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    // Every worker runs in-process below; a wall-clock cron firing mid-journey would race the counts.
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) await job.stop();
  });

  beforeEach(async () => {
    await resetTestDatabase();
    // Platform catalogue a deployment seeds, not tenant data.
    await prisma.designTemplate.create({
      data: { key: 'journey-06', name: 'Journey', allowedFonts: ['Inter'], supportedBlocks: [BlockType.HERO, BlockType.RSVP] },
    });
    await prisma.messageTemplate.createMany({ data: MESSAGE_COPY.map((template) => ({ ...template, organizationId: null })) });
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    const email = app.get<Map<MessageChannel, MessageTransport>>(MESSAGE_TRANSPORTS).get(MessageChannel.EMAIL);
    if (email instanceof SmtpTransport) email.close();
    await app.close();
    await disconnectTestDatabase();
    await rm(root, { recursive: true, force: true });
    for (const key of INTAKE_ENV) delete process.env[key];
    if (previousPilotMode === undefined) delete process.env.PILOT_MODE;
    else process.env.PILOT_MODE = previousPilotMode;
  });

  const as = (authorization: string) => ({
    get: (path: string) => http().get(`/api/v1${path}`).set('Authorization', authorization),
    post: (path: string, body: object = {}) => http().post(`/api/v1${path}`).set('Authorization', authorization).send(body),
    put: (path: string, body: object) => http().put(`/api/v1${path}`).set('Authorization', authorization).send(body),
    patch: (path: string, body: object) => http().patch(`/api/v1${path}`).set('Authorization', authorization).send(body),
    delete: (path: string) => http().delete(`/api/v1${path}`).set('Authorization', authorization),
  });
  type Caller = ReturnType<typeof as>;

  const fakeBank = () => app.get(PaymentGatewayRegistry).get(PaymentProvider.FAKE) as FakeGateway;
  // The private-media worker runs in its own process, outside AppModule; built here as that process builds it.
  const mediaWorker = () => new PrivateMediaRunner(prisma as unknown as PrismaService, app.get(PrivateStorageService));
  const dispatch = () => app.get(CommunicationsService).dispatchDue();
  const image = () => sharp({ create: { width: 640, height: 480, channels: 3, background: '#7a8b74' } }).jpeg().toBuffer();

  /** The personal link a sent message carries. */
  const linkIn = (body: string) => {
    const match = /\/invitations\/([^/\s]+)\/g\/([^/\s]+)/.exec(body);
    if (!match) throw new Error('No personal link in message');
    return { path: `/invitations/${match[1]}/g/${match[2]}`, token: match[2] };
  };

  const csvOf = async (host: Caller, path: string) => parseCsv((await host.get(path).buffer(true).expect(200)).text);

  const GUEST_CSV = [
    'First name,Last name,Email,Phone,Household,Seats',
    `Ani,Hakobyan,Ani@Journey06.test,${ANI_PHONE},Ani & Narek,2`,
    'Davit,Sargsyan,davit@journey06.test,,Sargsyan,1',
  ].join('\n');

  /**
   * The host builds a public, paid event over HTTP: an invitation with a
   * free-text question and a signed statement, dietary options, a ticket
   * type and a published listing, a booked caterer-photographer with a wide
   * brief, and the two-household guest list.
   */
  const hostBuildsTheEvent = async () => {
    const { authorization } = await authenticateAs(app, prisma);
    const host = as(authorization);
    await host.post('/organizations', { name: 'Hakobyan Events' }).expect(201);
    const { body: event } = await host.post('/events', {
      type: EventType.OTHER, title: 'Autumn Gala', templateKey: 'journey-06', startsAt: new Date(Date.now() + 90 * DAY_MS).toISOString(),
      timezone: 'Asia/Yerevan', locales: ['en'], defaultLocale: 'en',
    }).expect(201);
    const eventId = event.id as string;
    const slug = event.invitation.slug as string;
    const base = `/events/${eventId}`;

    await host.patch(`/invitations/${slug}/rsvp-fields`, {
      dietary: { options: [{ key: 'vegan', label: { en: 'Vegan' } }] },
      drinkPreference: { options: [{ key: 'wine', label: { en: 'Wine' } }] },
    }).expect(200);
    const { body: note } = await host.post(`/invitations/${slug}/questions`, { type: 'TEXT', prompt: { en: 'Anything we should know?' } }).expect(201);
    const { body: statement } = await host.post(`/invitations/${slug}/questions`, { type: 'SIGNATURE', prompt: { en: 'I accept the house rules' } }).expect(201);
    await host.post(`${base}/venues`, { role: 'RECEPTION', name: 'Ararat Hall', address: '1 Abovyan St, Yerevan', capacity: 100 }).expect(201);
    await host.post(`/invitations/${slug}/publish`).expect(201);

    await host.patch(`${base}/settings`, { visibility: 'PUBLIC' }).expect(200);
    const { body: type } = await host.post(`${base}/ticket-types`, { name: { en: 'General' }, priceMinor: '10000', quantityTotal: 10, maxPerOrder: 4 }).expect(201);
    const { body: listing } = await host.put(`${base}/listing`, { headline: { en: 'Autumn Gala' } }).expect(200);
    await host.post(`${base}/listing/publish`).expect(201);

    const { body: vendor } = await host.post('/vendors', { name: 'Tashir Catering', category: 'CATERING' }).expect(201);
    const { body: booking } = await host.post(`${base}/vendors`, { vendorId: vendor.id, briefScopes: ['catering', 'households', 'contacts', 'playlist'] }).expect(201);

    const { body: imported } = await http().post(`/api/v1${base}/guests/import`).set('Authorization', authorization)
      .attach('file', Buffer.from(GUEST_CSV), { filename: 'guests.csv', contentType: 'text/csv' }).expect(201);
    expect(imported).toMatchObject({ status: 'COMPLETED', rowsImported: 2, rowsFailed: 0 });

    return { host, authorization, eventId, slug, base, noteId: note.id as string, statementId: statement.id as string,
      statementVersionId: statement.statementVersionId as string, typeId: type.id as string, listingSlug: listing.slug as string,
      briefToken: booking.briefToken as string };
  };
  type Gala = Awaited<ReturnType<typeof hostBuildsTheEvent>>;

  /** The invitation goes out and the outbox delivers it; each guest's link is in their message. */
  const invitationsGoOut = async (gala: Gala) => {
    const { body: sent } = await gala.host.post(`/invitations/${gala.slug}/send`).expect(201);
    expect(sent.queued).toBe(2);
    expect(await dispatch()).toMatchObject({ sent: 2, failed: 0 });
    const messages = await prisma.message.findMany({ where: { eventId: gala.eventId, templateKey: 'invitation.send' }, select: { toAddress: true, status: true, body: true } });
    expect(messages.map((message) => [message.toAddress.toLowerCase(), message.status]).sort()).toEqual([
      [ANI, MessageStatus.SENT], ['davit@journey06.test', MessageStatus.SENT]]);
    const linkFor = (address: string) => linkIn(messages.find((message) => message.toAddress.toLowerCase() === address)!.body);
    return { ani: linkFor(ANI), davit: linkFor('davit@journey06.test') };
  };
  type Links = Awaited<ReturnType<typeof invitationsGoOut>>;

  /**
   * Ani answers for herself and adds Narek, signing the statement for both
   * (for him as his representative), connects Telegram through the bot's
   * deep link, and uploads a photo the host approves for the gallery.
   */
  const aniTakesPart = async (gala: Gala, links: Links) => {
    const signature = { statementVersionId: gala.statementVersionId, method: 'TYPED', signerName: 'Ani Hakobyan', isAcknowledged: true, locale: 'en' };
    const { body: answer } = await http().post(`/api/v1${links.ani.path}/rsvp`).send({
      status: 'ATTENDING', dietary: ['vegan'], dietaryNotes: 'coeliac', drinkPreference: 'wine', songRequest: 'Sirun Yar', message: 'With love, Ani',
      answers: [{ questionId: gala.noteId, value: 'I am pregnant, please seat me near the door' }, { questionId: gala.statementId, value: signature }],
      party: [{ firstName: 'Narek', lastName: 'Hakobyan', dietaryNotes: 'nut allergy', answers: [{ questionId: gala.statementId, value: { ...signature, isRepresentative: true } }] }],
    }).expect(201);
    expect(answer).toMatchObject({ status: 'ATTENDING', partyAdded: 1 });
    expect(await prisma.guestAcknowledgement.count({ where: { eventId: gala.eventId } })).toBe(2);

    await http().post('/api/v1/webhooks/telegram').send({ message: { chat: { id: ANI_TELEGRAM_CHAT }, text: `/start ${links.ani.token}` } }).expect(201);
    expect(await prisma.guestChannel.findMany({ select: { channel: true, address: true } })).toEqual([{ channel: MessageChannel.TELEGRAM, address: String(ANI_TELEGRAM_CHAT) }]);

    const { body: photo } = await http().post(`/api/v1${links.ani.path}/gallery`).field('caption', 'Ani at the gala')
      .attach('file', await image(), { filename: 'ani.jpg', contentType: 'image/jpeg' }).expect(201);
    expect(await mediaWorker().runOne()).toBe(true);
    await gala.host.patch(`${gala.base}/gallery/${photo.id as string}`, { moderationStatus: 'APPROVED' }).expect(200);
    const { body: davitSees } = await http().get(`/api/v1${links.davit.path}/gallery`).expect(200);
    expect(davitSees.items).toEqual([expect.objectContaining({ id: photo.id, caption: 'Ani at the gala', isOwn: false })]);
    return photo.id as string;
  };

  /** Ani also has an Aveline account, signed in on her phone with push turned on. */
  const aniHasAnAccount = async () => {
    await http().post('/api/v1/auth/register').send({ email: ANI, password: ANI_PASSWORD, name: 'Ani Hakobyan' }).expect(202);
    const { body: session } = await http().post('/api/v1/auth/login').set('User-Agent', 'Ani iPhone').send({ email: ANI, password: ANI_PASSWORD }).expect(201);
    const account = as(`Bearer ${session.accessToken as string}`);
    await account.post('/devices', { platform: 'IOS', token: ANI_DEVICE }).expect(201);
    expect(await prisma.deviceToken.count({ where: { token: ANI_DEVICE, revokedAt: null } })).toBe(1);
    await account.get('/me/organizations').expect(200);
    expect(await prisma.session.findMany({ where: { user: { email: ANI } }, select: { userAgent: true, ipAddress: true } }))
      .toEqual([{ userAgent: 'Ani iPhone', ipAddress: expect.stringContaining('127.0.0.1') }]);
    return { account, refreshToken: session.refreshToken as string };
  };

  /**
   * Ani buys two paid tickets — one for herself, one for her friend Lilit —
   * and pays through the bank. The ticket email is left in the outbox,
   * undelivered, as a message still waiting to go.
   */
  const aniBuysTickets = async (gala: Gala) => {
    const { body: detail } = await http().get(`/api/v1/public/events/${gala.listingSlug}`).query({ locale: 'en' }).expect(200);
    const { body: order } = await http().post(`/api/v1/public/events/${gala.listingSlug}/orders`).send({
      items: [{ ticketTypeId: gala.typeId, quantity: 2 }], buyerName: 'Ani Hakobyan', buyerEmail: 'ANI@journey06.test', buyerPhone: ANI_PHONE,
      locale: 'en', provider: 'FAKE', returnUrl: `${APP_URL}/tickets/return`, idempotencyKey: randomUUID(), attendanceRevision: detail.checkout.attendanceRevision,
      attendees: [
        { ticketTypeId: gala.typeId, firstName: 'Ani', lastName: 'Hakobyan', email: ANI, dietary: ['vegan'] },
        { ticketTypeId: gala.typeId, firstName: 'Lilit', lastName: 'Grigoryan', email: 'lilit@journey06.test' },
      ],
    }).expect(201);
    fakeBank().simulateSuccess(new URL(order.payment.redirectUrl as string).searchParams.get('fakePayment')!);
    await http().post(`/api/v1/payments/${order.payment.orderNumber as string}/confirm`).expect(201);
    const { body: paid } = await http().post(`/api/v1/ticket-orders/${order.accessToken as string}/confirm`).expect(201);
    expect(paid).toMatchObject({ status: 'PAID', totalMinor: '20000' });
    expect(await prisma.message.findMany({ where: { templateKey: 'ticket.issued' }, select: { status: true } })).toEqual([{ status: MessageStatus.QUEUED }]);
    return { orderId: order.orderId as string, accessToken: order.accessToken as string };
  };
  type Purchase = Awaited<ReturnType<typeof aniBuysTickets>>;

  /** Aveline sales once spoke to Ani about her own wedding; the enquiry holds her address. */
  const salesRecordedAnEnquiry = async (staff: Caller) => {
    const { body } = await staff.post('/sales/enquiries', { contact: { name: 'Ani Hakobyan', email: ANI, phone: ANI_PHONE } })
      .set('Idempotency-Key', 'journey-06-enquiry').expect(201);
    return body.enquiry.id as string;
  };

  /** A stored guest-list export, produced by the export worker, that names her. */
  const hostExportsAndChecksIn = async (gala: Gala) => {
    const { body: snapshot } = await gala.host.post(`${gala.base}/export-snapshots`, { kind: 'GUEST_LIST', format: 'CSV', locale: 'en', idempotencyKey: randomUUID() }).expect(201);
    await app.get(ExportRunner).runOne();
    const rows = await csvOf(gala.host, `${gala.base}/export-snapshots/${snapshot.id as string}/download`);
    expect(rows.filter((row) => row.Email?.toLowerCase() === ANI)).toHaveLength(2);

    const aniGuest = await prisma.guest.findFirstOrThrow({ where: { eventId: gala.eventId, firstName: 'Ani', ticket: null } });
    await gala.host.post(`${gala.base}/guests/${aniGuest.id}/check-in`).expect(201);
    return snapshot.id as string;
  };

  const staffMember = async () => {
    const staff = await authenticateAs(app, prisma);
    await prisma.user.update({ where: { id: staff.userId }, data: { platformRole: 'ADMIN' } });
    return as(staff.authorization);
  };

  /**
   * She asks, with no account, in the capitals she happened to type; Aveline
   * staff find it in their queue, verify her, and the first attempt to
   * fulfil is refused until her historical sales enquiry is bound too.
   */
  const aniAsksAndStaffVerify = async (staff: Caller, enquiryId: string) => {
    const { body: receipt } = await http().post('/api/v1/privacy/requests')
      .send({ kind: 'ERASURE', subjectEmail: 'Ani@Journey06.test', notes: 'Please forget me everywhere.' }).expect(201);
    expect(receipt).toMatchObject({ kind: 'ERASURE', status: 'RECEIVED' });
    expect(receipt).not.toHaveProperty('reference');

    const { body: queue } = await staff.get('/privacy/requests?status=RECEIVED').expect(200);
    expect(queue).toEqual([expect.objectContaining({ kind: 'ERASURE', subjectEmail: ANI })]);
    const requestId = queue[0].id as string;
    // The public form proves nothing about who typed it.
    const { body: unverified } = await staff.post(`/privacy/requests/${requestId}/fulfil`).expect(400);
    expect(unverified.message).toMatch(/IN_PROGRESS/);
    await staff.patch(`/privacy/requests/${requestId}`, { status: 'VERIFYING' }).expect(200);
    await staff.patch(`/privacy/requests/${requestId}`, { status: 'IN_PROGRESS', notes: 'Identity confirmed by reply from the address' }).expect(200);

    const { body: unbound } = await staff.post(`/privacy/requests/${requestId}/fulfil`).expect(400);
    expect(unbound.message).toMatch(/Enquiry subjects must be verified/);
    expect(await prisma.guest.count({ where: { email: ANI } })).toBe(2);

    const { body: candidates } = await staff.post('/privacy/enquiry-subject-candidates', { email: ANI }).expect(200);
    expect(candidates.items).toEqual([expect.objectContaining({ enquiryId, name: 'Ani Hakobyan', email: ANI })]);
    const contactId = candidates.items[0].id as string;
    await staff.put(`/privacy/requests/${requestId}/enquiry-subjects`, { contactIds: [contactId], verificationNote: 'Same mailbox as the request' }).expect(200);
    return { requestId, contactId };
  };

  const fulfilErasure = async (staff: Caller, requestId: string) => {
    const forgetPerson = jest.spyOn(app.get(AuditService), 'forgetPerson');
    const forgetGuests = jest.spyOn(app.get(AnalyticsService), 'forgetGuests');
    const aniGuestIds = (await prisma.guest.findMany({ where: { email: ANI }, select: { id: true } })).map((guest) => guest.id).sort();
    const userId = (await prisma.user.findFirstOrThrow({ where: { email: ANI } })).id;
    const attendanceOf = () => prisma.attendanceResponse.findMany({ where: { guestId: { in: aniGuestIds } }, select: { guestId: true, scopeId: true, status: true }, orderBy: [{ guestId: 'asc' }, { scopeId: 'asc' }] });
    const attendanceBefore = await attendanceOf();
    expect(attendanceBefore).toHaveLength(2);

    const { body: result } = await staff.post(`/privacy/requests/${requestId}/fulfil`).expect(201);

    // Both of her guest rows (invited, and created by her own ticket), her
    // attendee capture, her order, both households that named her, both
    // signatures she gave, her photo, every message to her, her account and
    // her enquiry. Narek and Lilit are other people and are not counted.
    expect(result).toMatchObject({
      reference: requestId, kind: 'ERASURE', guestsAnonymised: 2, ticketAttendeesAnonymised: 1, ticketOrdersAnonymised: 1,
      householdsRenamed: 2, acknowledgementsErased: 2, privateMediaQueuedForDeletion: 1, messagesRedacted: 3,
      accountsClosed: 1, invitesWithdrawn: 0, enquiriesCleared: 1, suppressionsHashed: 0,
    });
    expect(result).not.toHaveProperty('recoveryPending');
    // Whether she is coming is not personal data about her once her name is gone, and the headcount depends on it.
    expect(await attendanceOf()).toEqual(attendanceBefore);
    expect(await prisma.dataSubjectRequest.findUniqueOrThrow({ where: { id: requestId } })).toMatchObject({ status: 'COMPLETED' });
    // The Mongo traces go after commit: the audit trail forgets her, view analytics unlink her guests.
    expect(forgetPerson).toHaveBeenCalledWith({ email: ANI, userId });
    expect(forgetGuests).toHaveBeenCalledTimes(1);
    expect((forgetGuests.mock.calls[0][0]).slice().sort()).toEqual(aniGuestIds);
    return { userId };
  };

  /** What Ani and the other guests see through their links afterwards. */
  const guestsSeeHerGone = async (links: Links) => {
    await http().get(`/api/v1${links.ani.path}`).expect(404);
    await http().post(`/api/v1${links.ani.path}/rsvp`).send({ status: 'DECLINED' }).expect(404);
    // Another guest's link is untouched by her erasure.
    const { body: davitOpens } = await http().get(`/api/v1${links.davit.path}`).expect(200);
    expect(JSON.stringify(davitOpens)).not.toMatch(/ani@/i);
    const { body: gallery } = await http().get(`/api/v1${links.davit.path}/gallery`).expect(200);
    expect(gallery.items).toEqual([]);
  };

  /**
   * What the host sees: two "Removed" rows that still came, a renamed
   * household around Narek, whose own answers stay, no
   * acknowledgement records signed by her, and her photo gone.
   */
  const hostSeesWhatStayed = async (gala: Gala) => {
    const { body: households } = await gala.host.get(`${gala.base}/guests`).expect(200);
    interface Row { household: string; firstName: string; isCheckedIn: boolean }
    const people: Row[] = (households as { name: string; guests: Omit<Row, 'household'>[] }[])
      .flatMap((household) => household.guests.map((guest) => ({ household: household.name, ...guest })));
    const removed = people.filter((guest) => guest.firstName === 'Removed');
    expect(removed).toHaveLength(2);
    for (const guest of removed) {
      expect(guest).toMatchObject({ lastName: null, email: null, phone: null, isAnonymized: true, rsvpStatus: 'ATTENDING',
        rsvp: expect.objectContaining({ dietary: [], dietaryNotes: null, drinkPreference: null, songRequest: null, message: null }) });
    }
    expect(removed.filter((guest) => guest.isCheckedIn)).toHaveLength(1);
    // "Ani & Narek" named her and "Ani" was only her: both are renumbered, Narek keeps his place.
    const narek = people.find((guest) => guest.firstName === 'Narek')!;
    expect(new Set(people.map((guest) => guest.household))).toEqual(new Set(['Household 1', 'Household 2', 'Lilit', 'Sargsyan']));
    expect(removed.map((guest) => guest.household)).toContain(narek.household);
    expect(narek).toMatchObject({ lastName: 'Hakobyan', rsvpStatus: 'ATTENDING', rsvp: expect.objectContaining({ dietaryNotes: 'nut allergy' }) });
    expect(people.find((guest) => guest.firstName === 'Lilit')).toMatchObject({ email: 'lilit@journey06.test', isAnonymized: false });

    const { body: acknowledgements } = await gala.host.get(`${gala.base}/acknowledgements`).expect(200);
    expect(acknowledgements.items).toEqual([]);
    const { body: gallery } = await gala.host.get(`${gala.base}/gallery`).expect(200);
    expect((gallery.items as { processingStatus: string }[]).filter((item) => item.processingStatus !== 'REMOVED')).toEqual([]);
    const { body: arrivals } = await gala.host.get(`${gala.base}/arrivals`).expect(200);
    expect(arrivals).toMatchObject({ arrived: 1 });
    return narek.household;
  };

  /** Exports: the stored file is revoked; anything built now names nobody. */
  const exportsForgetHer = async (gala: Gala, snapshotId: string) => {
    const snapshots = `${gala.base}/export-snapshots`;
    await gala.host.get(`${snapshots}/${snapshotId}/download`).expect(410);
    const { body: revoked } = await gala.host.get(`${snapshots}/${snapshotId}`).expect(200);
    expect(revoked).toMatchObject({ status: 'FAILED', failureReason: 'SUBJECT_ERASED', recovery: { action: 'REGENERATE' } });

    const { body: again } = await gala.host.post(snapshots, { kind: 'GUEST_LIST', format: 'CSV', locale: 'en', idempotencyKey: randomUUID() }).expect(201);
    await app.get(ExportRunner).runOne();
    const regenerated = await csvOf(gala.host, `${snapshots}/${again.id as string}/download`);
    const { body: live } = await gala.host.post(`${gala.base}/exports`, { kind: 'GUEST_LIST' }).expect(201);
    const legacy = await csvOf(gala.host, (live.downloadPath as string).replace('/api/v1', ''));
    for (const rows of [regenerated, legacy]) {
      const text = JSON.stringify(rows);
      expect(text).not.toMatch(/ani@|Hakobyan.*Ani|\+37491000006|pregnant|coeliac|With love/i);
      expect(rows.filter((row) => row['First name'] === 'Removed')).toHaveLength(2);
      expect(rows.find((row) => row['First name'] === 'Narek')).toMatchObject({ 'Dietary notes': 'nut allergy', RSVP: 'ATTENDING' });
      expect(rows).toHaveLength(5);
    }
  };

  /** The vendor's brief is derived live: the caterer still has four covers and no longer has her. */
  const vendorBriefForgetsHer = async (gala: Gala, narekHousehold: string) => {
    const { body: brief } = await http().get(`/api/v1/briefs/${gala.briefToken}`).expect(200);
    expect(JSON.stringify(brief)).not.toMatch(/ani@|Ani|\+37491000006|coeliac|Sirun Yar/);
    expect(brief.catering).toMatchObject({ covers: 4, notes: [{ guest: 'Narek Hakobyan', household: narekHousehold, note: 'nut allergy' }] });
    expect((brief.catering.requirements as { count: number }[]).filter((item) => item.count > 0)).toEqual([]);
    expect(brief.playlist.tracks).toEqual([]);
    expect((brief.contacts as { name: string }[]).map((contact) => contact.name).sort()).toEqual(['Lilit Grigoryan', 'Narek Hakobyan', 'Removed', 'Removed']);
  };

  /** The order keeps its money and loses the buyer; Lilit keeps her ticket. */
  const ticketsKeepTheMoney = async (gala: Gala, purchase: Purchase) => {
    const { body: order } = await gala.host.get(`${gala.base}/ticket-orders/${purchase.orderId}`).expect(200);
    const { body: orders } = await gala.host.get(`${gala.base}/ticket-orders`).expect(200);
    expect(orders).toEqual([expect.objectContaining({ orderId: purchase.orderId, status: 'PAID', buyerName: 'Removed', totalMinor: '20000', tickets: 2,
      buyerEmail: expect.stringMatching(/@erased\.invalid$/) })]);
    expect((order.tickets as { status: string }[]).map((ticket) => ticket.status)).toEqual(['VALID', 'VALID']);
    expect(JSON.stringify(order)).not.toMatch(/ani@|\+37491000006/i);
    const attendees = (order.attendees as { firstName: string; email: string | null }[]).map((person) => [person.firstName, person.email]);
    expect(attendees).toEqual(expect.arrayContaining([['Removed', null], ['Lilit', 'lilit@journey06.test']]));
    const { body: buyerLink } = await http().get(`/api/v1/ticket-orders/${purchase.accessToken}`).expect(200);
    expect(buyerLink).toMatchObject({ status: 'PAID', totalMinor: '20000' });
    expect((buyerLink.attendees as { firstName: string }[]).map((person) => person.firstName)).toEqual(['Removed', 'Lilit']);
    expect((buyerLink.tickets as { holderName: string | null }[]).map((ticket) => ticket.holderName).sort()).toEqual(['Lilit Grigoryan', null]);
  };

  /** Outbox, chat, push, account, files and enquiry: every other place she was. */
  const everythingElseIsGone = async (account: Awaited<ReturnType<typeof aniHasAnAccount>>, userId: string, contactId: string) => {
    const messages = await prisma.message.findMany({ where: { OR: [{ guest: { firstName: 'Removed' } }, { templateKey: 'ticket.issued' }] } });
    expect(messages).toHaveLength(3);
    expect(messages.every((message) => message.body === '[erased]' && message.toAddress === '[erased]' && message.subject === null)).toBe(true);
    // What was still waiting to go is stopped, not delivered to an address it no longer knows.
    expect(messages.filter((message) => message.status === MessageStatus.QUEUED)).toEqual([]);
    expect(messages.filter((message) => message.status === MessageStatus.FAILED).map((message) => message.failureReason))
      .toEqual(['Recipient’s data was erased', 'Recipient’s data was erased']);
    expect(await dispatch()).toMatchObject({ sent: 0 });

    expect(await prisma.guestChannel.count()).toBe(0);
    expect(await prisma.deviceToken.count({ where: { token: ANI_DEVICE } })).toBe(0);
    await http().post('/api/v1/auth/login').send({ email: ANI, password: ANI_PASSWORD }).expect(401);
    await account.account.get('/me/organizations').expect(401);
    await http().post('/api/v1/auth/refresh').send({ refreshToken: account.refreshToken }).expect(401);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: userId } })).toMatchObject({ name: 'Removed', isActive: false, passwordHash: null });
    expect(await prisma.session.findMany({ where: { userId }, select: { userAgent: true, ipAddress: true, revokedAt: true } }))
      .toEqual([{ userAgent: null, ipAddress: null, revokedAt: expect.any(Date) }]);

    expect(await prisma.enquiryContact.findUniqueOrThrow({ where: { id: contactId } })).toMatchObject({ email: null, phone: null });
  };

  /** The durable media worker removes the original and both derived files. */
  const photoFilesAreDeleted = async (photoId: string) => {
    const photo = await prisma.guestMedia.findUniqueOrThrow({ where: { id: photoId } });
    expect(photo).toMatchObject({ processingStatus: 'REMOVED', caption: null, uploaderGuestId: null });
    const storage = app.get(PrivateStorageService);
    const keys = [photo.sourceKey, photo.displayKey!, photo.thumbnailKey!];
    await Promise.all(keys.map((key) => expect(storage.get(key)).resolves.toBeInstanceOf(Buffer)));

    expect(await mediaWorker().cleanup()).toEqual({ cleared: 1 });

    await Promise.all(keys.map((key) => expect(storage.get(key)).rejects.toMatchObject({ code: 'ENOENT' })));
    expect(await prisma.guestMedia.findUniqueOrThrow({ where: { id: photoId } })).toMatchObject({ storedBytes: 0, reservedBytes: 0, clearedAt: expect.any(Date) });
  };

  /**
   * The ERASED record: the host sees it without her address and cannot lift
   * it, and re-uploading the original spreadsheet does not bring her back.
   */
  const suppressionKeepsHerOut = async (gala: Gala) => {
    const { body: suppressions } = await gala.host.get('/suppressions').expect(200);
    const erased = (suppressions as { id: string; channel: string; address: string; reason: string; scope: string }[]).filter((row) => row.reason === 'ERASED');
    expect(erased.map((row) => row.channel).sort()).toEqual(['EMAIL', 'SMS', 'TELEGRAM', 'WHATSAPP']);
    expect(erased.every((row) => row.address === '[erased]' && row.scope === 'ORGANIZATION')).toBe(true);
    await gala.host.delete(`/suppressions/${erased[0].id}`).expect(409);

    const { body: reimport } = await http().post(`/api/v1${gala.base}/guests/import`).set('Authorization', gala.authorization)
      .attach('file', Buffer.from(`${GUEST_CSV}\nAram,Petrosyan,aram@journey06.test,,Petrosyan,1\nA.,H.,,${ANI_PHONE},H.,1`), { filename: 'guests.csv', contentType: 'text/csv' }).expect(201);
    expect(reimport).toMatchObject({ rowsImported: 2, rowsFailed: 2 });
    // Her row by email (row 2) and a row carrying only her phone (row 5) are both refused; Davit and Aram are not.
    const refusal = 'This person asked for their data to be erased and cannot be added again';
    expect(reimport.errors).toEqual([{ row: 2, message: refusal }, { row: 5, message: refusal }]);
    expect(await prisma.guest.count({ where: { eventId: gala.eventId, email: { equals: ANI, mode: 'insensitive' } } })).toBe(0);
  };

  /**
   * Typing her address in again by hand still never reaches her: the send
   * reports her as suppressed, records why, and the outbox delivers to
   * everyone else. Her anonymised rows are reported as erased, not missing.
   */
  const suppressionStopsMessaging = async (gala: Gala) => {
    await gala.host.post(`${gala.base}/guests`, { firstName: 'Ani', lastName: 'Again', email: 'ANI@journey06.test' }).expect(201);

    const { body: sent } = await gala.host.post(`/invitations/${gala.slug}/send`).expect(201);

    expect(sent.suppressed).toEqual([{ householdName: 'Ani Again', toAddress: ANI }]);
    expect((sent.recipients as { toAddress: string }[]).map((recipient) => recipient.toAddress).sort()).toEqual(['aram@journey06.test', 'lilit@journey06.test']);
    expect(sent).toMatchObject({ queued: 2, alreadySent: 1 });
    expect((sent.unreachable as { reason: string }[]).map((row) => row.reason).sort())
      .toEqual(['No email address for anyone in this household', 'This guest asked for their data to be removed']);
    const toHer = await prisma.message.findMany({ where: { toAddress: ANI }, select: { status: true, failureReason: true } });
    expect(toHer).toEqual([{ status: MessageStatus.SUPPRESSED, failureReason: 'Recipient is suppressed' }]);
    expect(await dispatch()).toMatchObject({ sent: 2 });
    expect(await prisma.message.count({ where: { toAddress: ANI, status: MessageStatus.SENT } })).toBe(0);
  };

  it('erases Ani from every module after a full event, through the public request and staff verification, and keeps her from coming back', async () => {
    const gala = await hostBuildsTheEvent();
    const links = await invitationsGoOut(gala);
    const photoId = await aniTakesPart(gala, links);
    const account = await aniHasAnAccount();
    const purchase = await aniBuysTickets(gala);
    const staff = await staffMember();
    const enquiryId = await salesRecordedAnEnquiry(staff);
    const snapshotId = await hostExportsAndChecksIn(gala);
    expect(JSON.stringify((await http().get(`/api/v1/briefs/${gala.briefToken}`).expect(200)).body)).toContain(ANI);

    const { requestId, contactId } = await aniAsksAndStaffVerify(staff, enquiryId);
    const { userId } = await fulfilErasure(staff, requestId);

    await guestsSeeHerGone(links);
    const narekHousehold = await hostSeesWhatStayed(gala);
    await exportsForgetHer(gala, snapshotId);
    await vendorBriefForgetsHer(gala, narekHousehold);
    await ticketsKeepTheMoney(gala, purchase);
    await everythingElseIsGone(account, userId, contactId);
    await photoFilesAreDeleted(photoId);
    await suppressionKeepsHerOut(gala);
    await suppressionStopsMessaging(gala);
  });
});
