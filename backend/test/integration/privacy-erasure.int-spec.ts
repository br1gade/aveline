import { BadRequestException } from '@nestjs/common';
import {
  DataSubjectRequestKind,
  DataSubjectRequestStatus,
  DevicePlatform,
  EventRole,
  MessageChannel,
  OrganizationRole,
  PrismaClient,
  QuestionType,
  RsvpStatus,
} from '@prisma/client';
import { PrivacyService } from '../../src/modules/privacy/privacy.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { StorageService } from '../../src/infra/storage/storage.service';
import { AuditService } from '../../src/infra/audit/audit.service';
import { AnalyticsService } from '../../src/infra/analytics/analytics.service';
import { SuppressionService } from '../../src/modules/communications/suppression.service';
import { GuestImportService } from '../../src/modules/guests/import/guest-import.service';
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
  // What lives outside Postgres, recorded rather than reached.
  const removedFiles: string[] = [];
  const forgottenPeople: { email: string; userId: string | null }[] = [];
  const forgottenGuests: string[][] = [];

  beforeAll(() => {
    prisma = testPrisma();
    service = new PrivacyService(
      prisma as unknown as PrismaService,
      { removeByUrl: (url: string) => Promise.resolve(void removedFiles.push(url)) } as unknown as StorageService,
      { forgetPerson: (person: { email: string; userId: string | null }) => Promise.resolve(void forgottenPeople.push(person)) } as unknown as AuditService,
      { forgetGuests: (ids: string[]) => Promise.resolve(void forgottenGuests.push(ids)) } as unknown as AnalyticsService,
    );
  });

  beforeEach(async () => {
    removedFiles.length = 0;
    forgottenPeople.length = 0;
    forgottenGuests.length = 0;
    await resetTestDatabase();
  });
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
      data: { email: 'Ani@Example.AM', phone: '+37491000000', firstName: 'Ani', lastName: 'Hakobyan' },
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
      data: {
        userId: user.id,
        tokenHash: 'session-of-ani',
        expiresAt: new Date(Date.now() + 86_400_000),
        ipAddress: '198.51.100.7',
        userAgent: 'Ani’s phone',
      },
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

    const signature = await prisma.mediaAsset.create({
      data: { eventId, kind: 'SIGNATURE', url: 'https://files.test/signature-of-ani.png', mimeType: 'image/png', sizeBytes: 10 },
    });
    await prisma.rsvp.update({ where: { id: rsvp.id }, data: { signatureAssetId: signature.id } });

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
    expect(household).toMatchObject({ name: 'Household 1', notes: null });
    expect(result).toMatchObject({ householdsRenamed: 1 });
  });

  // D20: "Ani & Davit" beside an anonymised row is Ani, named again.
  it('renames a household still named after them, even with someone left in it', async () => {
    const { householdId, eventId } = await personEverywhere();
    await prisma.household.update({ where: { id: householdId }, data: { name: 'Ani & Davit', notes: 'Davit drives' } });
    await prisma.guest.create({
      data: { eventId, householdId, firstName: 'Davit', lastName: 'Petrosyan', token: 'davit-token', rsvp: { create: {} } },
    });

    await erase();

    const household = await prisma.household.findUniqueOrThrow({ where: { id: householdId } });
    expect(household).toMatchObject({ name: 'Household 1', notes: 'Davit drives' });
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

  it('forgets where and on what they signed in', async () => {
    const { userId } = await personEverywhere();

    await erase();

    const session = await prisma.session.findFirstOrThrow({ where: { userId } });
    expect(session).toMatchObject({ ipAddress: null, userAgent: null });
  });

  it('withdraws every team invitation addressed to them', async () => {
    const { eventId } = await personEverywhere();
    const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    const expiresAt = new Date(Date.now() + 86_400_000);
    await prisma.organizationInvite.create({
      data: { organizationId: event.organizationId, email: ADDRESS, role: OrganizationRole.MEMBER, tokenHash: 'org-invite', expiresAt },
    });
    await prisma.eventInvite.create({ data: { eventId, email: 'ANI@example.am', role: EventRole.VIEWER, tokenHash: 'event-invite', expiresAt } });

    const result = await erase();

    expect(await prisma.organizationInvite.count()).toBe(0);
    expect(await prisma.eventInvite.count()).toBe(0);
    expect(result).toMatchObject({ invitesWithdrawn: 2 });
  });

  it('removes their signature file and their traces in the audit trail and view analytics, after commit', async () => {
    const { guestId, userId } = await personEverywhere();

    await erase();

    expect(removedFiles).toEqual(['https://files.test/signature-of-ani.png']);
    expect(forgottenPeople).toEqual([{ email: ADDRESS, userId }]);
    expect(forgottenGuests).toEqual([[guestId]]);
  });

  // D15: deleting a complaint let them be written to again; keeping it kept the address.
  it('keeps a platform-wide complaint as a hash that still blocks them', async () => {
    await personEverywhere();
    const suppressions = new SuppressionService(prisma as unknown as PrismaService);
    await suppressions.suppress({ organizationId: null, channel: MessageChannel.EMAIL, address: ADDRESS, reason: 'COMPLAINT' });

    const result = await erase();

    const rows = await prisma.suppression.findMany({ where: { organizationId: null } });
    expect(rows).toHaveLength(1);
    expect(rows[0].address).toMatch(/^sha256:/);
    expect(await suppressions.isSuppressed(MessageChannel.EMAIL, 'Ani@Example.am', null)).toBe(true);
    expect(result).toMatchObject({ suppressionsHashed: 1 });
  });

  // D21: re-importing the original spreadsheet brought them straight back.
  it('stops the organization that held them from importing or messaging them again, and no one else', async () => {
    const { eventId } = await personEverywhere();
    const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    const elsewhere = await seedEvent(prisma);
    const otherOrganization = (await prisma.event.findUniqueOrThrow({ where: { id: elsewhere.eventId } })).organizationId;

    await erase();

    const suppressions = new SuppressionService(prisma as unknown as PrismaService);
    expect(await suppressions.isSuppressed(MessageChannel.EMAIL, ADDRESS, event.organizationId)).toBe(true);
    expect(await suppressions.isSuppressed(MessageChannel.SMS, '+37491000000', event.organizationId)).toBe(true);
    expect(await suppressions.isSuppressed(MessageChannel.EMAIL, ADDRESS, otherOrganization)).toBe(false);

    const imports = new GuestImportService(prisma as unknown as PrismaService);
    const csv = Buffer.from('First Name,Last Name,Email\nAni,Hakobyan,ani@example.am\nAram,Sargsyan,aram@example.am\n');
    const here = await imports.importCsv(eventId, 'guests.csv', csv);
    expect(here).toMatchObject({ rowsImported: 1, rowsFailed: 1 });
    expect(await prisma.guest.count({ where: { eventId, firstName: 'Ani' } })).toBe(0);
    const there = await imports.importCsv(elsewhere.eventId, 'guests.csv', csv);
    expect(there).toMatchObject({ rowsImported: 2, rowsFailed: 0 });
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
