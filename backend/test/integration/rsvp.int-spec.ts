import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageChannel, MessageStatus, PrismaClient, RsvpStatus } from '@prisma/client';
import { ConsoleTransport } from '../../src/modules/communications/channels/console.transport';
import { MessageTransport } from '../../src/modules/communications/channels/message-channel';
import { CommunicationsService } from '../../src/modules/communications/communications.service';
import { GuestChannelsService } from '../../src/modules/communications/guest-channels.service';
import { SuppressionService } from '../../src/modules/communications/suppression.service';
import { RsvpConfirmerService } from '../../src/modules/invitations/sending/rsvp-confirmer.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RsvpService } from '../../src/modules/rsvp/rsvp.service';
import { seedEvent } from '../fixtures/event.fixture';
import {
  disconnectTestDatabase,
  resetTestDatabase,
  testPrisma,
} from '../setup/test-database';

/**
 * Integration scope: the service against a real Postgres. What is under test
 * is the transaction boundary and the relational writes — a mocked Prisma
 * would only confirm our own assumptions about them.
 */
describe('RsvpService (integration)', () => {
  let prisma: PrismaClient;
  let service: RsvpService;

  beforeAll(() => {
    prisma = testPrisma();
    const prismaService = prisma as unknown as PrismaService;
    const transports = new Map<MessageChannel, MessageTransport>(
      Object.values(MessageChannel).map((channel) => [channel, new ConsoleTransport(channel)]),
    );
    const communications = new CommunicationsService(
      prismaService,
      transports,
      new SuppressionService(prismaService),
    );
    const confirmer = new RsvpConfirmerService(
      prismaService,
      communications,
      new GuestChannelsService(prismaService),
      ({ get: (key: string) => ({ PUBLIC_APP_URL: 'https://aveline.test' })[key] }) as unknown as ConfigService,
    );
    service = new RsvpService(prismaService, confirmer);
  });

  beforeEach(() => resetTestDatabase());
  afterAll(() => disconnectTestDatabase());

  it('records a response and stamps the time it arrived', async () => {
    const { slug, primaryGuestToken } = await seedEvent(prisma);

    const result = await service.submit(slug, primaryGuestToken, {
      status: RsvpStatus.ATTENDING,
      dietary: ['vegetarian'],
      drinkPreference: 'wine',
      songRequest: 'Sirun Yar',
    });

    expect(result.status).toBe(RsvpStatus.ATTENDING);
    expect(result.respondedAt).toBeInstanceOf(Date);

    const stored = await prisma.rsvp.findFirstOrThrow({ where: { guest: { token: primaryGuestToken } } });
    expect(stored.dietary).toEqual(['vegetarian']);
    expect(stored.drinkPreference).toBe('wine');
  });

  it('turns named plus-ones into household members that inherit attribution', async () => {
    const { slug, primaryGuestToken, householdId } = await seedEvent(prisma, { seatsAllotted: 3 });

    const result = await service.submit(slug, primaryGuestToken, {
      status: RsvpStatus.ATTENDING,
      attribution: 'SIDE_B',
      party: [{ firstName: 'Plus', lastName: 'One' }, { firstName: 'Plus', lastName: 'Two' }],
    });

    expect(result.partyAdded).toBe(2);
    expect(result.seatsRemaining).toBe(0);

    const members = await prisma.guest.findMany({ where: { householdId }, orderBy: { firstName: 'asc' } });
    expect(members).toHaveLength(3);
    expect(members.every((m) => m.attribution === 'SIDE_B')).toBe(true);
    expect(members.filter((m) => m.addedByGuest)).toHaveLength(2);
    // Every added member gets their own capability token.
    expect(new Set(members.map((m) => m.token)).size).toBe(3);
  });

  // Boundary set: 2 seats allotted, 1 already named. 1 more fits, 2 does not.
  it('accepts a party that exactly fills the household allowance', async () => {
    const { slug, primaryGuestToken } = await seedEvent(prisma, { seatsAllotted: 2 });

    await expect(
      service.submit(slug, primaryGuestToken, {
        status: RsvpStatus.ATTENDING,
        party: [{ firstName: 'Exactly' }],
      }),
    ).resolves.toMatchObject({ partyAdded: 1, seatsRemaining: 0 });
  });

  it('rejects a party that would exceed the household allowance by one', async () => {
    const { slug, primaryGuestToken } = await seedEvent(prisma, { seatsAllotted: 2 });

    await expect(
      service.submit(slug, primaryGuestToken, {
        status: RsvpStatus.ATTENDING,
        party: [{ firstName: 'One' }, { firstName: 'TooMany' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rolls the whole submission back when capacity is exceeded', async () => {
    const { slug, primaryGuestToken, householdId } = await seedEvent(prisma, { seatsAllotted: 1 });

    await expect(
      service.submit(slug, primaryGuestToken, {
        status: RsvpStatus.ATTENDING,
        party: [{ firstName: 'Rejected' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const members = await prisma.guest.findMany({ where: { householdId } });
    expect(members).toHaveLength(1);
    const rsvp = await prisma.rsvp.findFirstOrThrow({ where: { guest: { token: primaryGuestToken } } });
    expect(rsvp.status).toBe(RsvpStatus.PENDING);
  });

  it('is idempotent — resubmitting updates rather than duplicating', async () => {
    const { slug, primaryGuestToken } = await seedEvent(prisma);

    await service.submit(slug, primaryGuestToken, { status: RsvpStatus.ATTENDING });
    await service.submit(slug, primaryGuestToken, { status: RsvpStatus.DECLINED });

    const rsvps = await prisma.rsvp.findMany({ where: { guest: { token: primaryGuestToken } } });
    expect(rsvps).toHaveLength(1);
    expect(rsvps[0].status).toBe(RsvpStatus.DECLINED);
  });

  it('refuses a response to an unpublished invitation', async () => {
    const { slug, primaryGuestToken } = await seedEvent(prisma, { isPublished: false });

    await expect(
      service.submit(slug, primaryGuestToken, { status: RsvpStatus.ATTENDING }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses an unrecognised guest token', async () => {
    const { slug } = await seedEvent(prisma);

    await expect(
      service.submit(slug, 'not-a-real-token', { status: RsvpStatus.ATTENDING }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('confirming the answer to the guest', () => {
    /** The fixture guest, given an address and Aveline's confirmation copy. */
    const withCopy = async () => {
      const seeded = await seedEvent(prisma);
      await prisma.guest.updateMany({
        where: { eventId: seeded.eventId },
        data: { email: 'guest@test.local' },
      });
      for (const key of [
        'rsvp.confirmation.attending',
        'rsvp.confirmation.declined',
        'rsvp.confirmation.undecided',
      ]) {
        await prisma.messageTemplate.create({
          data: {
            organizationId: null,
            key,
            channel: MessageChannel.EMAIL,
            subject: { hy: '{{eventTitle}}' },
            body: { hy: '{{guestName}} — {{link}}' },
          },
        });
      }
      return seeded;
    };

    const confirmations = () =>
      prisma.message.findMany({
        where: { templateKey: { startsWith: 'rsvp.confirmation' } },
        orderBy: { createdAt: 'asc' },
      });

    it('confirms an answer to the guest who gave it', async () => {
      const { slug, primaryGuestToken } = await withCopy();

      await service.submit(slug, primaryGuestToken, { status: RsvpStatus.ATTENDING });

      const sent = await confirmations();
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        templateKey: 'rsvp.confirmation.attending',
        toAddress: 'guest@test.local',
        status: MessageStatus.QUEUED,
      });
      // The link lets them change their answer.
      expect(sent[0].body).toContain(`/invitations/${slug}/g/${primaryGuestToken}`);
    });

    it.each([
      { status: RsvpStatus.DECLINED, key: 'rsvp.confirmation.declined' },
      { status: RsvpStatus.UNDECIDED, key: 'rsvp.confirmation.undecided' },
    ])('uses the $status copy for that answer', async ({ status, key }) => {
      const { slug, primaryGuestToken } = await withCopy();

      await service.submit(slug, primaryGuestToken, { status });

      expect((await confirmations())[0].templateKey).toBe(key);
    });

    /**
     * Every response, as decided — and a guest who switches from attending to
     * declined is exactly the one who most needs to know the host saw it.
     */
    it('confirms a changed answer again', async () => {
      const { slug, primaryGuestToken } = await withCopy();

      await service.submit(slug, primaryGuestToken, { status: RsvpStatus.ATTENDING });
      await service.submit(slug, primaryGuestToken, { status: RsvpStatus.DECLINED });

      expect((await confirmations()).map((message) => message.templateKey)).toEqual([
        'rsvp.confirmation.attending',
        'rsvp.confirmation.declined',
      ]);
    });

    // A double-submitted form is one answer.
    it('sends one confirmation for the same answer submitted twice at once', async () => {
      const { slug, primaryGuestToken } = await withCopy();

      await service.submit(slug, primaryGuestToken, { status: RsvpStatus.ATTENDING });
      await service.submit(slug, primaryGuestToken, { status: RsvpStatus.ATTENDING });

      expect(await confirmations()).toHaveLength(1);
    });

    /**
     * The answer is saved before the confirmation is queued, and a failure to
     * queue must not tell the guest their reply was lost.
     */
    it('still saves the answer when there is no copy to confirm with', async () => {
      const { slug, primaryGuestToken } = await withCopy();
      await prisma.messageTemplate.deleteMany();

      const result = await service.submit(slug, primaryGuestToken, {
        status: RsvpStatus.ATTENDING,
      });

      expect(result.status).toBe(RsvpStatus.ATTENDING);
      expect(await confirmations()).toHaveLength(0);
    });

    // Answered from a forwarded link with no address anywhere in the
    // household: there is nobody to write to, and that is not an error.
    it('sends nothing, quietly, when nobody in the household can be reached', async () => {
      const { slug, primaryGuestToken, eventId } = await withCopy();
      await prisma.guest.updateMany({ where: { eventId }, data: { email: null } });

      await expect(
        service.submit(slug, primaryGuestToken, { status: RsvpStatus.ATTENDING }),
      ).resolves.toMatchObject({ status: RsvpStatus.ATTENDING });
      expect(await confirmations()).toHaveLength(0);
    });
  });

});