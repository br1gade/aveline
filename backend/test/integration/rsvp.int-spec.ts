import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaClient, RsvpStatus } from '@prisma/client';
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
    service = new RsvpService(prisma as unknown as PrismaService);
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
});
