import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { EventRole, InvitationStatus, MessageChannel, OrganizationRole, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { seedEvent } from '../../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

const WEBHOOK_SECRET = 'sending-comms-telegram-secret';
/** Every timer except Date stays real when the clock is frozen. */
const REAL_TIMERS = ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
  'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] as const;

/**
 * The host's sending controls over HTTP — who may press them, on whose
 * invitation, and what notify-changes accepts — and the Telegram webhook's
 * secret as Telegram actually presents it, in a header.
 */
describe('sending and communications (e2e, coverage)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const savedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

  const http = () => request(app.getHttpServer() as Server);

  beforeAll(async () => {
    prisma = testPrisma();
    // Read when the webhook controller is built, so set before compiling.
    process.env.TELEGRAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    // Nothing here dispatches; a wall-clock sweep must not race the assertions.
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) await job.stop();
  });

  beforeEach(() => resetTestDatabase());

  afterAll(async () => {
    if (savedSecret === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET;
    else process.env.TELEGRAM_WEBHOOK_SECRET = savedSecret;
    await app.close();
    await disconnectTestDatabase();
  });

  /** A published invitation with copy for sending, reminding and announcing changes, and a contactable guest. */
  const hostedEvent = async (role: EventRole = EventRole.OWNER, options: { isPublished?: boolean } = {}) => {
    const seeded = await seedEvent(prisma, options);
    const event = await prisma.event.findUniqueOrThrow({ where: { id: seeded.eventId } });
    // A real deployment seeds these as Aveline defaults; the test database starts empty.
    const copy = {
      'invitation.send': '{{guestName}} {{link}}',
      'rsvp.reminder': '{{guestName}} {{link}}',
      'event.details-changed': '{{guestName}} {{note}} {{link}}',
    };
    for (const [key, body] of Object.entries(copy)) {
      await prisma.messageTemplate.create({
        data: { organizationId: event.organizationId, key, channel: MessageChannel.EMAIL, subject: { hy: '{{eventTitle}}' }, body: { hy: body } },
      });
    }
    await prisma.guest.updateMany({ where: { eventId: seeded.eventId }, data: { email: 'armen@test.local' } });
    const member = await authenticateAs(app, prisma, { eventId: seeded.eventId, role });
    return { ...seeded, organizationId: event.organizationId, authorization: member.authorization };
  };

  const post = (path: string, authorization: string, body: Record<string, unknown> = {}) =>
    http().post(`/api/v1${path}`).set('Authorization', authorization).send(body);

  /** Sends the invitation, failing with the server's reason rather than a bare status. */
  const sendInvitations = async (slug: string, authorization: string) => {
    const response = await post(`/invitations/${slug}/send`, authorization);
    if (response.status !== 201) throw new Error(JSON.stringify(response.body));
  };

  const messagesOn = (eventId: string) => prisma.message.count({ where: { eventId } });

  /** Lets time pass after sending, so a reminder is due (D14). */
  const daysPass = () =>
    prisma.message.updateMany({ where: { templateKey: 'invitation.send' }, data: { createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000) } });

  /**
   * An event on which every action has something to queue: one household was
   * invited days ago (so remind and notify-changes would write to it) and one
   * was added since (so send would write to it). A refused press that leaves
   * the outbox unchanged then proves the refusal, not an empty audience.
   */
  const pressableEvent = async () => {
    const hosted = await hostedEvent();
    await sendInvitations(hosted.slug, hosted.authorization);
    await daysPass();
    await prisma.household.create({
      data: {
        eventId: hosted.eventId,
        name: 'Added later',
        guests: {
          create: { eventId: hosted.eventId, firstName: 'Lilit', email: 'lilit@test.local', isPrimary: true, token: `later-${hosted.eventId}` },
        },
      },
    });
    return hosted;
  };

  describe('a viewer of the event', () => {
    it.each(['send', 'remind', 'notify-changes'])('is refused POST %s with a 403 and nothing is queued, though the owner may', async (action) => {
      const owner = await pressableEvent();
      const viewer = await authenticateAs(app, prisma, { eventId: owner.eventId, role: EventRole.VIEWER });
      const before = await messagesOn(owner.eventId);

      await post(`/invitations/${owner.slug}/${action}`, viewer.authorization).expect(403);

      expect(await messagesOn(owner.eventId)).toBe(before);
      await post(`/invitations/${owner.slug}/${action}`, owner.authorization).expect(201);
      expect(await messagesOn(owner.eventId)).toBeGreaterThan(before);
    });
  });

  describe('the host of another organization', () => {
    /** Owner of a separate organization and of an event in it, with no standing on the first. */
    const outsider = async () => {
      const theirs = await hostedEvent();
      const signedIn = await authenticateAs(app, prisma, { eventId: theirs.eventId, role: EventRole.OWNER });
      await prisma.organizationMembership.create({
        data: { userId: signedIn.userId, organizationId: theirs.organizationId, role: OrganizationRole.OWNER },
      });
      return { ...signedIn, slug: theirs.slug };
    };

    it.each(['send', 'remind', 'notify-changes'])('is refused POST %s on an invitation they do not belong to, and nothing is queued', async (action) => {
      const ours = await pressableEvent();
      const before = await messagesOn(ours.eventId);
      const stranger = await outsider();

      await post(`/invitations/${ours.slug}/${action}`, stranger.authorization).expect(403);

      expect(await messagesOn(ours.eventId)).toBe(before);
      await post(`/invitations/${ours.slug}/${action}`, ours.authorization).expect(201);
      expect(await messagesOn(ours.eventId)).toBeGreaterThan(before);
    });

    it('cannot read the delivery report of an invitation they do not belong to', async () => {
      const ours = await hostedEvent();
      await sendInvitations(ours.slug, ours.authorization);
      const stranger = await outsider();

      const response = await http()
        .get(`/api/v1/invitations/${ours.slug}/delivery`)
        .set('Authorization', stranger.authorization)
        .expect(403);

      expect(JSON.stringify(response.body)).not.toContain('armen@test.local');
      // The same credentials do read their own invitation's report.
      await http().get(`/api/v1/invitations/${stranger.slug}/delivery`).set('Authorization', stranger.authorization).expect(200);
    });
  });

  describe('notify-changes', () => {
    const notify = (slug: string, authorization: string, body: Record<string, unknown> = {}) =>
      post(`/invitations/${slug}/notify-changes`, authorization, body);

    it('refuses a draft invitation with a 400 saying nobody has it yet', async () => {
      const { slug, eventId, authorization } = await hostedEvent(EventRole.OWNER, { isPublished: false });
      expect((await prisma.invitation.findUniqueOrThrow({ where: { slug } })).status).toBe(InvitationStatus.DRAFT);

      const { body } = await notify(slug, authorization).expect(400);

      expect(body.message).toMatch(/not been published/);
      expect(await messagesOn(eventId)).toBe(0);
    });

    it('rejects a note of 501 characters, naming the field, and queues nothing', async () => {
      const { slug, eventId, authorization } = await hostedEvent();
      await sendInvitations(slug, authorization);

      const { body } = await notify(slug, authorization, { note: 'x'.repeat(501) }).expect(400);

      expect(body.details).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'note' })]));
      expect(await prisma.message.count({ where: { eventId, templateKey: 'event.details-changed' } })).toBe(0);
    });

    it('accepts a note of exactly 500 characters and carries it in the message', async () => {
      const { slug, eventId, authorization } = await hostedEvent();
      await sendInvitations(slug, authorization);

      const { body } = await notify(slug, authorization, { note: 'x'.repeat(500) }).expect(201);

      expect(body).toMatchObject({ queued: 1, alreadyNotified: 0 });
      const notice = await prisma.message.findFirstOrThrow({ where: { eventId, templateKey: 'event.details-changed' } });
      expect(notice.body).toContain('x'.repeat(500));
    });

    describe('within and after the minute', () => {
      afterEach(() => jest.useRealTimers());

      /** Freezes only the clock, leaving real timers so HTTP and Prisma keep working. */
      const clockAt = (moment: Date) => jest.useFakeTimers({ now: moment, doNotFake: [...REAL_TIMERS] });

      it('counts a second press in the same minute as already notified, and queues a press in the next minute', async () => {
        // Ten seconds into a minute shortly ahead of the real clock, so sign-in tokens stay valid.
        const minute = Math.ceil(Date.now() / 60_000) * 60_000 + 60_000;
        clockAt(new Date(minute + 10_000));
        const { slug, eventId, authorization } = await hostedEvent();
        await sendInvitations(slug, authorization);
        await notify(slug, authorization, { note: 'First change.' }).expect(201);

        jest.setSystemTime(new Date(minute + 50_000));
        const { body: sameMinute } = await notify(slug, authorization, { note: 'First change.' }).expect(201);
        expect(sameMinute).toMatchObject({ queued: 0, alreadyNotified: 1 });

        jest.setSystemTime(new Date(minute + 70_000));
        const { body: nextMinute } = await notify(slug, authorization, { note: 'Second change.' }).expect(201);
        expect(nextMinute).toMatchObject({ queued: 1, alreadyNotified: 0 });

        const notices = await prisma.message.findMany({ where: { eventId, templateKey: 'event.details-changed' }, select: { body: true } });
        expect(notices).toHaveLength(2);
        expect(notices).toEqual(expect.arrayContaining([{ body: expect.stringContaining('Second change.') }]));
      });
    });
  });

  describe('the Telegram webhook, once a secret is set', () => {
    const webhook = () => http().post('/api/v1/webhooks/telegram');
    const startUpdate = (token: string) => ({ message: { chat: { id: 4242 }, text: `/start ${token}` } });

    it('refuses an update carrying no secret header, and links nothing', async () => {
      const { primaryGuestToken } = await seedEvent(prisma);

      await webhook().send(startUpdate(primaryGuestToken)).expect(401);

      expect(await prisma.guestChannel.count()).toBe(0);
    });

    it('refuses an update carrying the wrong secret, and links nothing', async () => {
      const { primaryGuestToken } = await seedEvent(prisma);

      await webhook().set('X-Telegram-Bot-Api-Secret-Token', 'wrong').send(startUpdate(primaryGuestToken)).expect(401);

      expect(await prisma.guestChannel.count()).toBe(0);
    });

    it('accepts an update with the right secret, without any sign-in, and links the chat', async () => {
      const { primaryGuestToken, eventId } = await seedEvent(prisma);

      const { body } = await webhook()
        .set('X-Telegram-Bot-Api-Secret-Token', WEBHOOK_SECRET)
        .send(startUpdate(primaryGuestToken))
        .expect(201);

      expect(body).toEqual({ ok: true });
      const guest = await prisma.guest.findFirstOrThrow({ where: { eventId, token: primaryGuestToken } });
      expect(await prisma.guestChannel.findMany({ where: { guestId: guest.id }, select: { channel: true, address: true } }))
        .toEqual([{ channel: MessageChannel.TELEGRAM, address: '4242' }]);
    });
  });
});
