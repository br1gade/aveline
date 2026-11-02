import { ThrottlerStorage } from '@nestjs/throttler';
import { UNTHROTTLED } from '../../fixtures/unthrottled.fixture';
import { createHmac } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { BlockType, EventType, MessageChannel, MessageStatus, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { SerializeInterceptor } from '../../../src/common/interceptors/serialize';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { MessageTransport } from '../../../src/modules/communications/channels/message-channel';
import { SmtpTransport } from '../../../src/modules/communications/channels/smtp.transport';
import { MESSAGE_TRANSPORTS } from '../../../src/modules/communications/communications.module';
import { CommunicationsService } from '../../../src/modules/communications/communications.service';
import { WhatsAppReceiptsService } from '../../../src/modules/communications/whatsapp/whatsapp-receipts.service';
import { configureWhatsAppBodyParser } from '../../../src/modules/communications/whatsapp/whatsapp-body-parser';
import { MESSAGE_COPY } from '../../../src/seed/message-copy';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Synthetic Meta and Telegram settings: no Meta account or test number exists yet. */
const CHANNEL_ENV: Record<string, string> = {
  WHATSAPP_ACCOUNT_ID: '140014',
  WHATSAPP_PHONE_NUMBER_ID: '240014',
  WHATSAPP_ACCESS_TOKEN: 'synthetic-whatsapp-access-token',
  WHATSAPP_API_VERSION: 'v21.0',
  WHATSAPP_APP_SECRET: 'synthetic-meta-app-secret-for-journey-14',
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'synthetic-verify-token-for-journey-14-x',
  TELEGRAM_BOT_TOKEN: 'synthetic-telegram-bot-token',
  TELEGRAM_BOT_USERNAME: 'aveline_journey14_bot',
};

const ANI = 'ani@journey14.test';
const ANI_PHONE = '+374 91 000014';
const ANI_CHAT = 14014;
const GOHAR_PHONE = '+374 93 000014';
const DAVIT = 'davit@journey14.test';
const WEBHOOK = '/api/v1/communications/whatsapp-webhook';

/** One outbound call a transport made to a provider, as the provider received it. */
interface ProviderCall { url: string; body: Record<string, unknown> }

/**
 * Journey 14: guests reached over WhatsApp, receipts back from Meta, a guest
 * who moves herself to Telegram, and erasure forgetting it all.
 *
 * The host imports three households over HTTP — Ani with an email and a
 * phone, Gohar with only a phone, Davit with only an email — and sends the
 * invitation. The outbox delivers through the real WhatsApp and SMTP
 * transports; only Meta's and Telegram's HTTP APIs are stood in for, at the
 * `fetch` boundary. Meta then posts signed status callbacks to the public
 * webhook, the receipt sweep runs in-process as its cron would, and the host
 * reads the delivery report. Ani taps her Telegram link (the bot's webhook),
 * Davit answers over HTTP, and the host's reminder therefore reaches only Ani,
 * on Telegram. Finally Ani's erasure request is verified and fulfilled by
 * staff: her chat channel is forgotten, her messages are redacted, and a
 * late Meta callback for her number changes nothing.
 */
describe('Journey 14: WhatsApp invitation, Meta receipts in the host report, Telegram opt-in, erasure (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let fetchSpy: jest.SpyInstance;
  const calls: ProviderCall[] = [];
  const original: Record<string, string | undefined> = {};
  const previousPilotMode = process.env.PILOT_MODE;
  const realFetch = globalThis.fetch;

  const http = () => request(app.getHttpServer());

  /** Meta's Graph API and Telegram's Bot API as each answers an accepted send. */
  const providers = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
    if (url.startsWith('https://graph.facebook.com/') || url.startsWith('https://api.telegram.org/')) {
      calls.push({ url, body: JSON.parse(init?.body as string) as Record<string, unknown> });
      return url.includes('graph.facebook.com') ? json({ messages: [{ id: `wamid.journey14.${calls.length}` }] }) : json({ ok: true, result: { message_id: calls.length } });
    }
    return realFetch(input, init);
  };

  beforeAll(async () => {
    process.env.PILOT_MODE = 'false';
    for (const [key, value] of Object.entries(CHANNEL_ENV)) { original[key] = process.env[key]; process.env[key] = value; }
    // Installed before the module compiles: the transports capture `fetch` when they are built.
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(providers);
    prisma = testPrisma();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).overrideProvider(ThrottlerStorage).useValue(UNTHROTTLED).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
    configureWhatsAppBodyParser(app);
    app.setGlobalPrefix('api/v1');
    app.useGlobalInterceptors(new SerializeInterceptor());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    // The outbox and receipt sweeps run in-process below; a wall-clock cron firing mid-journey would race the counts.
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) await job.stop();
  });

  beforeEach(async () => {
    await resetTestDatabase();
    calls.length = 0;
    // Platform data a deployment seeds: a design template, Aveline's copy, and
    // the Meta-approved WhatsApp invitation template the sender requires.
    await prisma.designTemplate.create({ data: { key: 'journey-14', name: 'Journey', allowedFonts: ['Inter'], supportedBlocks: [BlockType.HERO, BlockType.RSVP] } });
    await prisma.messageTemplate.createMany({ data: MESSAGE_COPY.map((template) => ({ ...template, organizationId: null })) });
    await prisma.messageTemplate.create({ data: {
      key: 'invitation.send', channel: MessageChannel.WHATSAPP, providerTemplate: 'aveline_invitation', providerParams: ['guestName', 'eventTitle', 'link'],
      body: { en: 'Dear {{guestName}}, you are invited to {{eventTitle}}. {{link}}' },
    } });
  });

  afterAll(async () => {
    fetchSpy.mockRestore();
    const email = app.get<Map<MessageChannel, MessageTransport>>(MESSAGE_TRANSPORTS).get(MessageChannel.EMAIL);
    if (email instanceof SmtpTransport) email.close();
    await app.close();
    await disconnectTestDatabase();
    for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    if (previousPilotMode === undefined) delete process.env.PILOT_MODE;
    else process.env.PILOT_MODE = previousPilotMode;
  });

  const as = (authorization: string) => ({
    get: (path: string) => http().get(`/api/v1${path}`).set('Authorization', authorization),
    post: (path: string, body: object = {}) => http().post(`/api/v1${path}`).set('Authorization', authorization).send(body),
    patch: (path: string, body: object) => http().patch(`/api/v1${path}`).set('Authorization', authorization).send(body),
  });
  type Caller = ReturnType<typeof as>;

  const dispatch = () => app.get(CommunicationsService).dispatchDue();
  const sweepReceipts = () => app.get(WhatsAppReceiptsService).reconcile();
  const whatsAppCalls = () => calls.filter((call) => call.url.includes('graph.facebook.com'));
  const telegramCalls = () => calls.filter((call) => call.url.includes('api.telegram.org'));

  /** The personal link inside a message, as the guest would tap it. */
  const linkIn = (text: string) => {
    const match = /\/invitations\/([^/\s]+)\/g\/([^/\s]+)/.exec(text);
    if (!match) throw new Error('No personal link in message');
    return { path: `/invitations/${match[1]}/g/${match[2]}`, token: match[2] };
  };

  /** A Meta status timestamp: whole seconds, some seconds in the past. */
  const metaSecondsAgo = (seconds: number) => Math.floor(Date.now() / 1000) - seconds;

  /** What Meta posts: a signed batch of statuses for this account and sender, by default stamped five seconds ago. */
  const metaCallback = (statuses: { id: string; status: string; errors?: { code: number; title: string }[] }[], at = metaSecondsAgo(5)) => {
    const timestamp = String(at);
    const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: CHANNEL_ENV.WHATSAPP_ACCOUNT_ID, changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp', metadata: { phone_number_id: CHANNEL_ENV.WHATSAPP_PHONE_NUMBER_ID },
      statuses: statuses.map((status) => ({ ...status, timestamp, recipient_id: 'not-read-by-aveline' })),
    } }] }] });
    const signature = `sha256=${createHmac('sha256', CHANNEL_ENV.WHATSAPP_APP_SECRET).update(raw).digest('hex')}`;
    return http().post(WEBHOOK).set('Content-Type', 'application/json').set('X-Hub-Signature-256', signature).send(raw);
  };

  const GUEST_CSV = [
    'First name,Last name,Email,Phone,Household,Seats',
    `Ani,Hakobyan,${ANI},${ANI_PHONE},Hakobyan,2`,
    `Gohar,Petrosyan,,${GOHAR_PHONE},Petrosyan,1`,
    `Davit,Sargsyan,${DAVIT},,Sargsyan,1`,
  ].join('\n');

  /** The host builds and publishes the event and imports three households over HTTP. */
  const hostPreparesTheEvent = async () => {
    const { authorization } = await authenticateAs(app, prisma);
    const host = as(authorization);
    await host.post('/organizations', { name: 'Hakobyan Weddings' }).expect(201);
    const { body: event } = await host.post('/events', {
      type: EventType.WEDDING, title: 'Ani and Narek', templateKey: 'journey-14', startsAt: new Date(Date.now() + 60 * DAY_MS).toISOString(),
      timezone: 'Asia/Yerevan', locales: ['en'], defaultLocale: 'en',
    }).expect(201);
    const eventId = event.id as string;
    const slug = event.invitation.slug as string;
    await host.post(`/events/${eventId}/venues`, { role: 'RECEPTION', name: 'Ararat Hall', address: '1 Abovyan St, Yerevan', capacity: 100 }).expect(201);
    await host.post(`/invitations/${slug}/publish`).expect(201);
    const { body: imported } = await http().post(`/api/v1/events/${eventId}/guests/import`).set('Authorization', authorization)
      .attach('file', Buffer.from(GUEST_CSV), { filename: 'guests.csv', contentType: 'text/csv' }).expect(201);
    expect(imported).toMatchObject({ status: 'COMPLETED', rowsImported: 3, rowsFailed: 0 });
    return { host, eventId, slug };
  };
  type Wedding = Awaited<ReturnType<typeof hostPreparesTheEvent>>;

  /**
   * The send chooses WhatsApp for every guest with a phone and email for the
   * one without; the outbox hands Meta the approved template with the guest's
   * own link as a positional parameter, and records Meta's message id.
   */
  const invitationGoesOutOverWhatsApp = async (wedding: Wedding) => {
    const { body: sent } = await wedding.host.post(`/invitations/${wedding.slug}/send`).expect(201);
    expect(sent).toMatchObject({ queued: 3, alreadySent: 0, suppressed: [], unreachable: [] });
    const channelOf = (household: string) => (sent.recipients as { householdName: string; channel: string; toAddress: string }[]).find((row) => row.householdName === household);
    expect(channelOf('Hakobyan')).toMatchObject({ channel: 'WHATSAPP', toAddress: ANI_PHONE });
    expect(channelOf('Petrosyan')).toMatchObject({ channel: 'WHATSAPP', toAddress: GOHAR_PHONE });
    expect(channelOf('Sargsyan')).toMatchObject({ channel: 'EMAIL', toAddress: DAVIT });

    expect(await dispatch()).toMatchObject({ sent: 3, failed: 0 });
    const toMeta = whatsAppCalls();
    expect(toMeta.map((call) => call.url)).toEqual([0, 1].map(() => `https://graph.facebook.com/v21.0/${CHANNEL_ENV.WHATSAPP_PHONE_NUMBER_ID}/messages`));
    expect(toMeta.map((call) => call.body.to).sort()).toEqual(['37491000014', '37493000014']);
    const sentTo = (digits: string) => toMeta.find((call) => call.body.to === digits)!.body as {
      type: string; template: { name: string; language: { code: string }; components: { parameters: { text: string }[] }[] } };
    const ani = sentTo('37491000014');
    expect(ani).toMatchObject({ type: 'template', template: { name: 'aveline_invitation', language: { code: 'en' } } });
    const [guestName, eventTitle, link] = ani.template.components[0].parameters.map((parameter) => parameter.text);
    expect([guestName, eventTitle]).toEqual(['Ani Hakobyan', 'Ani and Narek']);
    expect(sentTo('37493000014').template.components[0].parameters[0].text).toBe('Gohar Petrosyan');

    const messages = await prisma.message.findMany({ where: { eventId: wedding.eventId, templateKey: 'invitation.send' }, orderBy: { toAddress: 'asc' } });
    expect(messages.map((message) => [message.channel, message.status])).toEqual([
      [MessageChannel.WHATSAPP, MessageStatus.SENT], [MessageChannel.WHATSAPP, MessageStatus.SENT], [MessageChannel.EMAIL, MessageStatus.SENT]]);
    const refOf = (address: string) => messages.find((message) => message.toAddress === address)!.providerRef!;
    expect(refOf(ANI_PHONE)).toMatch(/^wamid\.journey14\./);
    const davit = linkIn(messages.find((message) => message.toAddress === DAVIT)!.body);
    const aniGuestId = messages.find((message) => message.toAddress === ANI_PHONE)!.guestId!;
    // The link Meta was handed is Ani's own, not merely a well-formed one.
    const aniGuest = await prisma.guest.findUniqueOrThrow({ where: { id: aniGuestId }, select: { firstName: true, token: true } });
    expect(aniGuest.firstName).toBe('Ani');
    expect(linkIn(link)).toEqual({ path: `/invitations/${wedding.slug}/g/${aniGuest.token}`, token: aniGuest.token });
    return { ani: { ...linkIn(link), wamid: refOf(ANI_PHONE), guestId: aniGuestId }, goharWamid: refOf(GOHAR_PHONE), davit };
  };
  type Sent = Awaited<ReturnType<typeof invitationGoesOutOverWhatsApp>>;

  interface ReportRow { household: string; channel: string; toAddress?: string; status: string; deliveredAt: string | null; readAt: string | null;
    deliveryFailedAt: string | null; deliveryErrorCode: number | null; deliveryFailureKind: string | null; failureReason: string | null; reminders: number }
  const deliveryReport = async (host: Caller, slug: string) => {
    const { body } = await host.get(`/invitations/${slug}/delivery`).expect(200);
    const rows = body.households as ReportRow[];
    return { body, row: (household: string) => rows.find((row) => row.household === household)! };
  };

  /**
   * Meta reports Ani's message delivered then read, and Gohar's failed with
   * an ambiguous code. Nothing changes until the sweep runs; after it the
   * host's report carries each outcome, Gohar is not suppressed and is not
   * re-sent to automatically.
   */
  const metaReportsBack = async (wedding: Wedding, sent: Sent) => {
    const reportedAt = metaSecondsAgo(5);
    const reportedAtIso = new Date(reportedAt * 1000).toISOString();
    await metaCallback([{ id: sent.ani.wamid, status: 'delivered' }, { id: sent.ani.wamid, status: 'read' },
      { id: sent.goharWamid, status: 'failed', errors: [{ code: 131026, title: 'Message undeliverable to +374 93 000014' }] }], reportedAt).expect(200, { accepted: true });
    expect(await prisma.whatsAppReceipt.count({ where: { processedAt: null } })).toBe(3);
    const beforeSweep = await deliveryReport(wedding.host, wedding.slug);
    expect(beforeSweep.row('Hakobyan')).toMatchObject({ status: 'SENT', deliveredAt: null, readAt: null });
    expect(beforeSweep.row('Petrosyan')).toMatchObject({ status: 'SENT', deliveryFailedAt: null, deliveryErrorCode: null });

    await sweepReceipts();

    const { body, row } = await deliveryReport(wedding.host, wedding.slug);
    expect(body).toMatchObject({ invited: 3, notSent: 0, unreachable: [] });
    expect(row('Hakobyan')).toMatchObject({ channel: 'WHATSAPP', toAddress: ANI_PHONE, status: 'DELIVERED', deliveredAt: reportedAtIso, readAt: reportedAtIso, deliveryErrorCode: null });
    expect(row('Petrosyan')).toMatchObject({ channel: 'WHATSAPP', status: 'FAILED', deliveredAt: null, readAt: null,
      deliveryFailedAt: reportedAtIso, deliveryErrorCode: 131026, deliveryFailureKind: 'AMBIGUOUS', failureReason: expect.any(String) });
    // Meta's own description quotes the number; the host sees Aveline's wording, never the provider's.
    expect(row('Petrosyan').failureReason).not.toMatch(/\+374|undeliverable/);
    expect(row('Sargsyan')).toMatchObject({ channel: 'EMAIL', status: 'SENT', deliveredAt: null });
    expect(await prisma.suppression.count()).toBe(0);
    expect(await dispatch()).toMatchObject({ sent: 0 });
    expect(whatsAppCalls()).toHaveLength(2);
  };

  /**
   * Ani taps the Telegram link from her invitation; Davit answers on his.
   * The host's reminder then chases only Ani — and on Telegram, the channel
   * she chose — while Davit, who replied, is left alone.
   */
  const aniMovesToTelegramAndIsReminded = async (wedding: Wedding, sent: Sent) => {
    const { body: page } = await http().get(`/api/v1${sent.ani.path}`).expect(200);
    expect(page.guest.name).toBe('Ani Hakobyan');
    expect(page.guest.telegramLink).toBe(`https://t.me/${CHANNEL_ENV.TELEGRAM_BOT_USERNAME}?start=${sent.ani.token}`);
    await http().post('/api/v1/webhooks/telegram').send({ message: { chat: { id: ANI_CHAT }, text: `/start ${sent.ani.token}` } }).expect(201);
    expect(await prisma.guestChannel.findMany({ select: { channel: true, address: true, optedInAt: true } }))
      .toEqual([{ channel: MessageChannel.TELEGRAM, address: String(ANI_CHAT), optedInAt: expect.any(Date) }]);

    await http().post(`/api/v1${sent.davit.path}/rsvp`).send({ status: 'DECLINED' }).expect(201);
    // Invitations went out four days ago: past the three-day wait before the first reminder.
    await prisma.message.updateMany({ where: { eventId: wedding.eventId, templateKey: 'invitation.send' }, data: { createdAt: new Date(Date.now() - 4 * DAY_MS) } });

    const { body: reminded } = await wedding.host.post(`/invitations/${wedding.slug}/remind`).expect(201);
    // Davit answered and Gohar's invitation never reached her: only Ani is chased, on the channel she chose.
    expect(reminded).toMatchObject({ queued: 1, alreadyRemindedToday: 0, recentlyInvited: 0,
      recipients: [{ householdName: 'Hakobyan', channel: 'TELEGRAM', toAddress: String(ANI_CHAT) }] });

    // The outbox holds Ani's Telegram reminder and Davit's own confirmation of his answer — nothing for Gohar.
    const queued = await prisma.message.findMany({ where: { status: MessageStatus.QUEUED }, orderBy: { templateKey: 'asc' }, select: { guestId: true, templateKey: true, channel: true, toAddress: true } });
    expect(queued).toEqual([
      { guestId: expect.any(String), templateKey: 'rsvp.confirmation.declined', channel: MessageChannel.EMAIL, toAddress: DAVIT },
      { guestId: sent.ani.guestId, templateKey: 'rsvp.reminder', channel: MessageChannel.TELEGRAM, toAddress: String(ANI_CHAT) }]);
    expect(await dispatch()).toMatchObject({ sent: 2, failed: 0 });
    expect(telegramCalls()).toEqual([expect.objectContaining({ body: expect.objectContaining({ chat_id: String(ANI_CHAT) }) })]);
    expect(linkIn(String(telegramCalls()[0].body.text)).token).toBe(sent.ani.token);
    expect((await deliveryReport(wedding.host, wedding.slug)).row('Hakobyan')).toMatchObject({ status: 'DELIVERED', readAt: expect.any(String), reminders: 1 });
  };

  /** Ani asks to be forgotten; Aveline staff verify and fulfil the request. */
  const aniIsErased = async () => {
    const staff = await authenticateAs(app, prisma);
    await prisma.user.update({ where: { id: staff.userId }, data: { platformRole: 'ADMIN' } });
    const admin = as(staff.authorization);
    await http().post('/api/v1/privacy/requests').send({ kind: 'ERASURE', subjectEmail: ANI }).expect(201);
    const { body: queue } = await admin.get('/privacy/requests?status=RECEIVED').expect(200);
    const requestId = queue[0].id as string;
    await admin.patch(`/privacy/requests/${requestId}`, { status: 'VERIFYING' }).expect(200);
    await admin.patch(`/privacy/requests/${requestId}`, { status: 'IN_PROGRESS', notes: 'Confirmed by reply' }).expect(200);
    const { body: result } = await admin.post(`/privacy/requests/${requestId}/fulfil`).expect(201);
    expect(result).toMatchObject({ guestsAnonymised: 1, messagesRedacted: 2 });
  };

  /**
   * Her Telegram chat is forgotten, both her messages are redacted, a late
   * Meta failure for her old message does not touch the erased record, and
   * the host's report no longer carries her phone, chat or name.
   */
  const theChannelIsForgotten = async (wedding: Wedding, sent: Sent) => {
    expect(await prisma.guestChannel.count()).toBe(0);
    const hers = await prisma.message.findMany({ where: { guestId: sent.ani.guestId } });
    expect(hers.map((message) => [message.channel, message.toAddress, message.body]).sort()).toEqual([
      [MessageChannel.TELEGRAM, '[erased]', '[erased]'], [MessageChannel.WHATSAPP, '[erased]', '[erased]']]);
    expect(hers.map((message) => message.providerParams)).toEqual([[], []]);

    // Late callbacks for her old message: a failure, and an earlier delivery and read that would otherwise move her
    // receipts back an hour. Neither touches the erased record.
    const evidence = { status: true, deliveredAt: true, readAt: true, providerStatusAt: true, deliveryFailedAt: true, deliveryErrorCode: true } as const;
    const beforeLate = await prisma.message.findFirstOrThrow({ where: { providerRef: sent.ani.wamid }, select: evidence });
    await metaCallback([{ id: sent.ani.wamid, status: 'failed', errors: [{ code: 131026, title: 'late' }] }]).expect(200);
    await metaCallback([{ id: sent.ani.wamid, status: 'delivered' }, { id: sent.ani.wamid, status: 'read' }], metaSecondsAgo(3600)).expect(200);
    await sweepReceipts();
    expect(await prisma.message.findFirstOrThrow({ where: { providerRef: sent.ani.wamid }, select: evidence })).toEqual(beforeLate);
    expect(beforeLate).toMatchObject({ status: MessageStatus.DELIVERED, deliveryErrorCode: null });
    expect(await prisma.whatsAppReceipt.count({ where: { processedAt: null } })).toBe(0);

    const { body } = await deliveryReport(wedding.host, wedding.slug);
    expect(JSON.stringify(body)).not.toMatch(/Ani|ani@|37491000014|\+374 91|14014/);
    expect((body.households as ReportRow[]).find((row) => row.household === 'Petrosyan')).toMatchObject({ status: 'FAILED', deliveryErrorCode: 131026 });
  };

  it('lists a household whose WhatsApp invitation failed under notInvited when the host reminds', async () => {
    const wedding = await hostPreparesTheEvent();
    const sent = await invitationGoesOutOverWhatsApp(wedding);
    await metaReportsBack(wedding, sent);
    await prisma.message.updateMany({ where: { eventId: wedding.eventId, templateKey: 'invitation.send' }, data: { createdAt: new Date(Date.now() - 4 * DAY_MS) } });

    const { body: reminded } = await wedding.host.post(`/invitations/${wedding.slug}/remind`).expect(201);

    // Gohar's invitation came back FAILED: she is told apart from the reminded, so the host re-sends to her.
    expect(reminded.notInvited).toEqual([expect.objectContaining({ householdName: 'Petrosyan', reason: expect.any(String) })]);
    expect((reminded.recipients as { householdName: string }[]).map((row) => row.householdName).sort()).toEqual(['Hakobyan', 'Sargsyan']);
  });

  it('reaches guests on WhatsApp, reports Meta receipts to the host, follows a Telegram opt-in and forgets the channel on erasure', async () => {
    const wedding = await hostPreparesTheEvent();
    const sent = await invitationGoesOutOverWhatsApp(wedding);
    await metaReportsBack(wedding, sent);
    await aniMovesToTelegramAndIsReminded(wedding, sent);
    await aniIsErased();
    await theChannelIsForgotten(wedding, sent);
    // Nothing in the journey — a failure, a reminder, an erasure — re-sent over WhatsApp.
    expect(whatsAppCalls()).toHaveLength(2);
  });
});
