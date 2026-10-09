import { BadRequestException } from '@nestjs/common';
import {
  DataSubjectRequestKind,
  DataSubjectRequestStatus,
  DevicePlatform,
  MessageChannel,
  PrismaClient,
  QuestionType,
  RsvpStatus,
} from '@prisma/client';
import { PrivacyService } from '../../src/modules/privacy/privacy.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

/**
 * Erasure has to reach everywhere a person's data went — not only the guest
 * row it was designed around. Each place below was found holding data after
 * an erasure that reported success. The person is deliberately written with
 * mixed capitals in some rows, because the request is stored lower-cased and
 * an exact match missed them.
 */
describe('Erasure (integration)', () => {
  let prisma: PrismaClient;
  let service: PrivacyService;

  beforeAll(() => {
    prisma = testPrisma();
    service = new PrivacyService(prisma as unknown as PrismaService);
  });

  beforeEach(() => resetTestDatabase());
  afterAll(() => disconnectTestDatabase());

  const ADDRESS = 'ani@example.am';
  const TELEGRAM_CHAT = '987654321';

  /** One person, with data in every place erasure has to reach. */
  const personEverywhere = async () => {
    const { eventId, slug } = await seedEvent(prisma);
    const invitation = await prisma.invitation.findUniqueOrThrow({ where: { slug } });
    const guest = await prisma.guest.findFirstOrThrow({ where: { eventId } });
    await prisma.guest.update({
      where: { id: guest.id },
      data: { email: 'Ani@Example.AM', phone: '+37491000000', lastName: 'Hakobyan' },
    });

    const [freeText, choice] = await Promise.all([
      prisma.rsvpQuestion.create({
        data: { invitationId: invitation.id, type: QuestionType.TEXT, prompt: { en: 'Anything else?' } },
      }),
      prisma.rsvpQuestion.create({
        data: {
          invitationId: invitation.id,
          type: QuestionType.SINGLE_CHOICE,
          prompt: { en: 'Meat or fish?' },
          options: { en: ['meat', 'fish'] },
        },
      }),
    ]);
    const rsvp = await prisma.rsvp.upsert({
      where: { guestId: guest.id },
      create: { guestId: guest.id, status: RsvpStatus.ATTENDING },
      update: { status: RsvpStatus.ATTENDING },
    });
    await prisma.rsvp.update({
      where: { id: rsvp.id },
      data: {
        dietary: ['vegan'],
        drinkPreference: 'the Areni my uncle makes',
        answers: {
          create: [
            { questionId: freeText.id, value: 'I am pregnant, please seat me near the door' },
            { questionId: choice.id, value: 'fish' },
          ],
        },
      },
    });

    await prisma.guestChannel.create({
      data: { guestId: guest.id, channel: MessageChannel.TELEGRAM, address: TELEGRAM_CHAT, optedInAt: new Date() },
    });
    await prisma.deviceToken.create({
      data: { guestId: guest.id, platform: DevicePlatform.WEB, token: 'push-token-of-ani' },
    });
    await prisma.message.createMany({
      data: [
        { eventId, guestId: guest.id, channel: MessageChannel.EMAIL, templateKey: 'invitation.send', toAddress: 'Ani@Example.AM', body: 'Dear Ani' },
        { eventId, guestId: guest.id, channel: MessageChannel.TELEGRAM, templateKey: 'rsvp.reminder', toAddress: TELEGRAM_CHAT, body: 'Ani, will you come?' },
      ],
    });

    const user = await prisma.user.create({
      data: { email: ADDRESS, name: 'Ani Hakobyan', passwordHash: 'x' },
    });
    await prisma.session.create({
      data: { userId: user.id, tokenHash: 'session-of-ani', expiresAt: new Date(Date.now() + 86_400_000) },
    });

    const type = await prisma.ticketType.create({ data: { eventId, priceMinor: 0n, quantityTotal: 10 } });
    const order = await prisma.ticketOrder.create({
      data: {
        eventId,
        buyerName: 'Ani Hakobyan',
        buyerEmail: 'ANI@example.am',
        totalMinor: 0n,
        idempotencyKey: 'order-of-ani',
        accessToken: 'access-of-ani',
      },
    });
    await prisma.ticket.create({
      data: {
        eventId,
        orderId: order.id,
        ticketTypeId: type.id,
        code: 'CODE-OF-ANI',
        holderName: 'Ani Hakobyan',
        holderEmail: 'Ani@example.am',
      },
    });

    return {
      guestId: guest.id,
      householdId: guest.householdId,
      eventId,
      rsvpId: rsvp.id,
      userId: user.id,
      orderId: order.id,
    };
  };

  const erase = async () => {
    const request = await prisma.dataSubjectRequest.create({
      data: {
        kind: DataSubjectRequestKind.ERASURE,
        subjectEmail: ADDRESS,
        status: DataSubjectRequestStatus.IN_PROGRESS,
        dueAt: new Date(Date.now() + 86_400_000),
      },
    });
    return service.fulfil(request.id, 'staff-user');
  };

  it('finds the person however their address was capitalised', async () => {
    const { guestId, orderId } = await personEverywhere();

    await erase();

    const guest = await prisma.guest.findUniqueOrThrow({ where: { id: guestId } });
    expect(guest).toMatchObject({ email: null, phone: null, lastName: null, firstName: 'Removed' });
    const order = await prisma.ticketOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.buyerName).toBe('Removed');
    expect(order.buyerEmail).not.toMatch(/ani/i);
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId } });
    expect(ticket.holderName).toBeNull();
    expect(ticket.holderEmail).toBeNull();
  });

  /**
   * Decided 9 October 2026: dietary tags and answers to the host's questions
   * go too. They are special-category data — "halal", a kosher-meal option —
   * and an anonymised row in a named household could still point at the
   * person. The catering count for that event drops by their requirements.
   */
  it('clears their dietary tags, drink and every answer to the host’s questions', async () => {
    const { rsvpId } = await personEverywhere();

    await erase();

    const rsvp = await prisma.rsvp.findUniqueOrThrow({ where: { id: rsvpId }, include: { answers: true } });
    expect(rsvp.drinkPreference).toBeNull();
    expect(rsvp.dietary).toEqual([]);
    expect(rsvp.answers).toEqual([]);
    // Whether they came stays: the headcount the caterer was paid for does not change.
    expect(rsvp.status).toBe(RsvpStatus.ATTENDING);
  });

  it('renames a household once everyone in it has been erased', async () => {
    const { householdId } = await personEverywhere();

    const result = await erase();

    const household = await prisma.household.findUniqueOrThrow({ where: { id: householdId } });
    expect(household).toMatchObject({ name: 'Removed', notes: null });
    expect(result).toMatchObject({ householdsRenamed: 1 });
  });

  it('keeps the name of a household with someone still in it', async () => {
    const { householdId, eventId } = await personEverywhere();
    await prisma.household.update({ where: { id: householdId }, data: { name: 'Hakobyan family' } });
    await prisma.guest.create({
      data: { eventId, householdId, firstName: 'Aram', token: 'aram-token', rsvp: { create: {} } },
    });

    await erase();

    expect((await prisma.household.findUniqueOrThrow({ where: { id: householdId } })).name).toBe('Hakobyan family');
  });

  it('forgets the chat and device the guest connected', async () => {
    const { guestId } = await personEverywhere();

    await erase();

    expect(await prisma.guestChannel.count({ where: { guestId } })).toBe(0);
    expect(await prisma.deviceToken.count({ where: { guestId } })).toBe(0);
  });

  it('redacts every message sent to them, on every channel, address included', async () => {
    const { guestId } = await personEverywhere();

    await erase();

    const messages = await prisma.message.findMany({ where: { guestId } });
    expect(messages).toHaveLength(2);
    for (const message of messages) {
      expect(message.body).toBe('[erased]');
      expect(message.toAddress).toBe('[erased]');
    }
  });

  it('closes their account so it can no longer sign in', async () => {
    const { userId } = await personEverywhere();

    const result = await erase();

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.isActive).toBe(false);
    expect(user.passwordHash).toBeNull();
    expect(user.email).not.toMatch(/ani/i);
    expect(user.name).toBe('Removed');
    expect(await prisma.session.count({ where: { userId, revokedAt: null } })).toBe(0);
    expect(result).toMatchObject({ accountsClosed: 1 });
  });

  describe('request status', () => {
    const requestIn = (
      status: DataSubjectRequestStatus,
      kind: DataSubjectRequestKind = DataSubjectRequestKind.ERASURE,
    ) =>
      prisma.dataSubjectRequest.create({
        data: { kind, subjectEmail: ADDRESS, status, dueAt: new Date(Date.now() + 86_400_000) },
      });

    it('cannot be reopened once completed', async () => {
      const done = await requestIn(DataSubjectRequestStatus.COMPLETED);

      await expect(
        service.update(done.id, 'staff', { status: DataSubjectRequestStatus.RECEIVED }),
      ).rejects.toThrow(BadRequestException);
    });

    // Marking it done by hand would report an erasure that never happened.
    it('cannot mark an erasure completed without carrying it out', async () => {
      const open = await requestIn(DataSubjectRequestStatus.IN_PROGRESS);

      await expect(
        service.update(open.id, 'staff', { status: DataSubjectRequestStatus.COMPLETED }),
      ).rejects.toThrow(/fulfil/);
    });

    // A correction is made by editing the record, so closing it by hand is the only way.
    it('lets a rectification be closed by hand once it is in progress', async () => {
      const open = await requestIn(DataSubjectRequestStatus.IN_PROGRESS, DataSubjectRequestKind.RECTIFICATION);

      await expect(
        service.update(open.id, 'staff', { status: DataSubjectRequestStatus.COMPLETED }),
      ).resolves.toMatchObject({ status: DataSubjectRequestStatus.COMPLETED });
    });
  });
});
