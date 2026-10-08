import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageChannel, PrismaClient, RsvpStatus } from '@prisma/client';
import { ConsoleTransport } from '../../src/modules/communications/channels/console.transport';
import { MessageTransport } from '../../src/modules/communications/channels/message-channel';
import { CommunicationsService } from '../../src/modules/communications/communications.service';
import { GuestChannelsService } from '../../src/modules/communications/guest-channels.service';
import { SuppressionService } from '../../src/modules/communications/suppression.service';
import { GuestManagementService } from '../../src/modules/guests/guest-management.service';
import { RsvpConfirmerService } from '../../src/modules/invitations/sending/rsvp-confirmer.service';
import { RsvpService } from '../../src/modules/rsvp/rsvp.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

/**
 * A host keeping their list right after it arrives. What is under test is
 * what a mock cannot show: that a household keeps exactly one primary through
 * every move and removal, that an emptied household goes, and that a host and
 * a guest writing to the same household at once cannot overfill it.
 */
describe('GuestManagementService (integration)', () => {
  let prisma: PrismaClient;
  let service: GuestManagementService;
  let rsvp: RsvpService;

  beforeAll(() => {
    prisma = testPrisma();
    const prismaService = prisma as unknown as PrismaService;
    service = new GuestManagementService(prismaService);

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
      ({ get: () => undefined }) as unknown as ConfigService,
    );
    rsvp = new RsvpService(prismaService, confirmer);
  });

  beforeEach(() => resetTestDatabase());
  afterAll(() => disconnectTestDatabase());

  const primariesIn = (householdId: string) =>
    prisma.guest.count({ where: { householdId, isPrimary: true } });

  describe('adding', () => {
    it('gives a guest without a household one of their own, as its primary', async () => {
      const { eventId } = await seedEvent(prisma);

      const guest = await service.addGuest(eventId, {
        firstName: 'Ani',
        lastName: 'Hakobyan',
        email: '  Ani@Example.AM ',
        seatsAllotted: 2,
      });

      const household = await prisma.household.findUniqueOrThrow({ where: { id: guest.householdId } });
      expect(household).toMatchObject({ name: 'Ani Hakobyan', seatsAllotted: 2 });
      expect(guest.isPrimary).toBe(true);
      expect(guest.email).toBe('ani@example.am');

      const stored = await prisma.guest.findUniqueOrThrow({
        where: { id: guest.id },
        include: { rsvp: true },
      });
      expect(stored.rsvp?.status).toBe(RsvpStatus.PENDING);
      expect(stored.consentSource).toBe('host-entry');
    });

    // The fixture household names one guest: two seats fit one more, one does not.
    it('fills an existing household that has a free seat', async () => {
      const { eventId, householdId } = await seedEvent(prisma, { seatsAllotted: 2 });

      const added = await service.addGuest(eventId, { firstName: 'Lusine', householdId });

      expect(added.isPrimary).toBe(false);
      expect(await primariesIn(householdId)).toBe(1);
    });

    it('refuses a household whose seats are all named', async () => {
      const { eventId, householdId } = await seedEvent(prisma, { seatsAllotted: 1 });

      await expect(service.addGuest(eventId, { firstName: 'Lusine', householdId })).rejects.toThrow(
        /householdId: .*raise seatsAllotted/,
      );
      expect(await prisma.guest.count({ where: { householdId } })).toBe(1);
    });

    it('refuses a household from another event', async () => {
      const { eventId } = await seedEvent(prisma);
      const other = await seedEvent(prisma);

      await expect(
        service.addGuest(eventId, { firstName: 'Lusine', householdId: other.householdId }),
      ).rejects.toThrow(NotFoundException);
    });

    it('changes nothing when an address is invalid', async () => {
      const { eventId } = await seedEvent(prisma);
      const before = await prisma.guest.count();

      await expect(
        service.addGuest(eventId, { firstName: 'Ani', email: 'ani@example.am\r\nRCPT TO:<x@y.am>' }),
      ).rejects.toThrow(/^email: /);
      await expect(service.addGuest(eventId, { firstName: 'Ani', phone: 'call me' })).rejects.toThrow(/^phone: /);
      expect(await prisma.guest.count()).toBe(before);
    });
  });

  describe('editing', () => {
    it('leaves omitted fields alone and clears an address sent empty', async () => {
      const { eventId } = await seedEvent(prisma);
      const added = await service.addGuest(eventId, {
        firstName: 'Ani',
        email: 'ani@example.am',
        phone: '+374 91 000000',
      });

      const updated = await service.updateGuest(eventId, added.id, { email: '', lastName: 'Hakobyan' });

      expect(updated).toMatchObject({
        firstName: 'Ani',
        lastName: 'Hakobyan',
        email: null,
        phone: '+374 91 000000',
      });
    });

    it('refuses to edit a guest whose details were erased', async () => {
      const { eventId } = await seedEvent(prisma);
      const added = await service.addGuest(eventId, { firstName: 'Ani' });
      await prisma.guest.update({ where: { id: added.id }, data: { anonymizedAt: new Date() } });

      await expect(service.updateGuest(eventId, added.id, { firstName: 'Ani' })).rejects.toThrow(/erased/);
    });

    it('404s a guest from another event', async () => {
      const { eventId } = await seedEvent(prisma);
      const other = await seedEvent(prisma);
      const stranger = await service.addGuest(other.eventId, { firstName: 'Ani' });

      await expect(service.updateGuest(eventId, stranger.id, { firstName: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('moving between households', () => {
    it('hands the link to someone else when the primary moves out', async () => {
      const { eventId, householdId } = await seedEvent(prisma, { seatsAllotted: 3 });
      const primary = await prisma.guest.findFirstOrThrow({ where: { householdId, isPrimary: true } });
      const sibling = await service.addGuest(eventId, { firstName: 'Lusine', householdId });
      const destination = await service.addGuest(eventId, { firstName: 'Mariam', seatsAllotted: 2 });

      const moved = await service.updateGuest(eventId, primary.id, { householdId: destination.householdId });

      expect(moved.isPrimary).toBe(false);
      expect(moved.householdId).toBe(destination.householdId);
      const promoted = await prisma.guest.findUniqueOrThrow({ where: { id: sibling.id } });
      expect(promoted.isPrimary).toBe(true);
      expect(await primariesIn(householdId)).toBe(1);
      expect(await primariesIn(destination.householdId)).toBe(1);
    });

    it('removes the household a last guest moved out of', async () => {
      const { eventId } = await seedEvent(prisma);
      const alone = await service.addGuest(eventId, { firstName: 'Ani' });
      const destination = await service.addGuest(eventId, { firstName: 'Mariam', seatsAllotted: 2 });

      await service.updateGuest(eventId, alone.id, { householdId: destination.householdId });

      expect(await prisma.household.findUnique({ where: { id: alone.householdId } })).toBeNull();
    });

    it('refuses a full destination and leaves the guest where they were', async () => {
      const { eventId } = await seedEvent(prisma);
      const ani = await service.addGuest(eventId, { firstName: 'Ani' });
      const full = await service.addGuest(eventId, { firstName: 'Mariam' });

      await expect(
        service.updateGuest(eventId, ani.id, { householdId: full.householdId, firstName: 'Anahit' }),
      ).rejects.toThrow(/householdId: /);

      const unchanged = await prisma.guest.findUniqueOrThrow({ where: { id: ani.id } });
      expect(unchanged).toMatchObject({ householdId: ani.householdId, firstName: 'Ani' });
    });
  });

  describe('removing', () => {
    it('removes a guest with their answer and seat, and promotes the next primary', async () => {
      const { eventId, householdId } = await seedEvent(prisma, { seatsAllotted: 3 });
      const primary = await prisma.guest.findFirstOrThrow({ where: { householdId, isPrimary: true } });
      const sibling = await service.addGuest(eventId, { firstName: 'Lusine', householdId });

      const result = await service.removeGuest(eventId, primary.id);

      expect(result).toEqual({ removed: primary.id, isHouseholdRemoved: false });
      expect(await prisma.rsvp.findUnique({ where: { guestId: primary.id } })).toBeNull();
      expect((await prisma.guest.findUniqueOrThrow({ where: { id: sibling.id } })).isPrimary).toBe(true);
    });

    it('removes a household left with nobody in it', async () => {
      const { eventId } = await seedEvent(prisma);
      const alone = await service.addGuest(eventId, { firstName: 'Ani' });

      const result = await service.removeGuest(eventId, alone.id);

      expect(result.isHouseholdRemoved).toBe(true);
      expect(await prisma.household.findUnique({ where: { id: alone.householdId } })).toBeNull();
    });

    it('refuses to remove a guest who was checked in, because that is the record they came', async () => {
      const { eventId } = await seedEvent(prisma);
      const ani = await service.addGuest(eventId, { firstName: 'Ani' });
      await prisma.checkIn.create({ data: { guestId: ani.id } });

      await expect(service.removeGuest(eventId, ani.id)).rejects.toThrow(/checked in/);
      expect(await prisma.guest.findUnique({ where: { id: ani.id } })).not.toBeNull();
    });
  });

  describe('household seats', () => {
    // Two guests are named once Lusine is added: two seats is the floor.
    const householdOfTwo = async () => {
      const seeded = await seedEvent(prisma, { seatsAllotted: 4 });
      await service.addGuest(seeded.eventId, { firstName: 'Lusine', householdId: seeded.householdId });
      return seeded;
    };

    it('goes down to exactly the guests already named', async () => {
      const { eventId, householdId } = await householdOfTwo();

      await expect(
        service.updateHousehold(eventId, householdId, { seatsAllotted: 2, name: 'Petrosyans' }),
      ).resolves.toEqual({ id: householdId, name: 'Petrosyans', seatsAllotted: 2, seatsNamed: 2 });
    });

    it('never goes below them, and changes nothing when refused', async () => {
      const { eventId, householdId } = await householdOfTwo();

      await expect(
        service.updateHousehold(eventId, householdId, { seatsAllotted: 1, name: 'Petrosyans' }),
      ).rejects.toThrow(/^seatsAllotted: /);

      const unchanged = await prisma.household.findUniqueOrThrow({ where: { id: householdId } });
      expect(unchanged).toMatchObject({ seatsAllotted: 4, name: 'Fixture Household' });
    });
  });

  /**
   * The reason every write here locks the household. Without it each writer
   * counts one free seat, both add, and a household of two seats has three
   * people — at the table, on the catering sheet and on the door list.
   */
  describe('writers racing for the last seat', () => {
    const settle = (attempts: Promise<unknown>[]) => Promise.allSettled(attempts);

    // Eight writers rather than two: with two, an unlocked version still
    // passes most runs because the second often starts after the first ends.
    it('lets only one of several hosts take it', async () => {
      const { eventId, householdId } = await seedEvent(prisma, { seatsAllotted: 2 });

      const results = await settle(
        Array.from({ length: 8 }, (_, i) => service.addGuest(eventId, { firstName: `Cousin ${i}`, householdId })),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(rejected.every((r) => r.reason instanceof BadRequestException)).toBe(true);
      expect(await prisma.guest.count({ where: { householdId } })).toBe(2);
    });

    it('lets only one of the hosts and the guest’s own plus-one take it', async () => {
      const { eventId, slug, householdId, primaryGuestToken } = await seedEvent(prisma, { seatsAllotted: 2 });

      const results = await settle([
        ...Array.from({ length: 4 }, (_, i) => service.addGuest(eventId, { firstName: `Cousin ${i}`, householdId })),
        rsvp.submit(slug, primaryGuestToken, { status: RsvpStatus.ATTENDING, party: [{ firstName: 'Narek' }] }),
        ...Array.from({ length: 3 }, (_, i) => service.addGuest(eventId, { firstName: `Aunt ${i}`, householdId })),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await prisma.guest.count({ where: { householdId } })).toBe(2);
    });
  });
});
