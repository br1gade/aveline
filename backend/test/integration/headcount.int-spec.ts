import { PrismaClient, RsvpStatus } from '@prisma/client';
import { AnalyticsService } from '../../src/infra/analytics/analytics.service';
import { OperationsService } from '../../src/modules/operations/operations.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

/**
 * The headcount a host watches as answers come in: by household — "have the
 * Petrosyans answered?" — and over time, which is what tells them whether to
 * chase. Counted in Postgres; checked here against a real one, because the
 * day a response falls on depends on the event's time zone.
 */
describe('Headcount by household and over time (integration)', () => {
  let prisma: PrismaClient;
  let operations: OperationsService;

  beforeAll(() => {
    prisma = testPrisma();
    operations = new OperationsService(
      prisma as unknown as PrismaService,
      { invitationViewSummary: () => Promise.resolve({ totalViews: 0, byLocale: [] }) } as unknown as AnalyticsService,
    );
  });

  beforeEach(() => resetTestDatabase());
  afterAll(() => disconnectTestDatabase());

  /** Two households: the Petrosyans (two coming, one declined) and the Sargsyans (not answered). */
  const twoFamilies = async () => {
    const { eventId, householdId } = await seedEvent(prisma, { seatsAllotted: 3 });
    await prisma.household.update({ where: { id: householdId }, data: { name: 'Petrosyan family' } });
    const sargsyans = await prisma.household.create({ data: { eventId, name: 'Sargsyan family', seatsAllotted: 2 } });
    const answer = async (householdId: string, firstName: string, status: RsvpStatus, respondedAt: string | null) =>
      prisma.guest.create({
        data: {
          eventId,
          householdId,
          firstName,
          token: `${firstName}-${eventId}`,
          rsvp: { create: { status, respondedAt: respondedAt ? new Date(respondedAt) : null } },
        },
      });
    const primary = await prisma.guest.findFirstOrThrow({ where: { householdId } });
    await prisma.rsvp.update({
      where: { guestId: primary.id },
      data: { status: RsvpStatus.ATTENDING, respondedAt: new Date('2027-05-01T08:00:00Z') },
    });
    // 22:30 UTC on 1 May is 02:30 on 2 May in Yerevan: the event's day, not the server's.
    await answer(householdId, 'Lusine', RsvpStatus.ATTENDING, '2027-05-01T22:30:00Z');
    await answer(householdId, 'Narek', RsvpStatus.DECLINED, '2027-05-03T10:00:00Z');
    await answer(sargsyans.id, 'Mariam', RsvpStatus.PENDING, null);
    return { eventId };
  };

  it('counts each household’s answers', async () => {
    const { eventId } = await twoFamilies();

    const headcount = await operations.headcount(eventId);

    expect(headcount.byHousehold).toEqual([
      expect.objectContaining({ name: 'Petrosyan family', seatsAllotted: 3, attending: 2, declined: 1, undecided: 0, pending: 0 }),
      expect.objectContaining({ name: 'Sargsyan family', seatsAllotted: 2, attending: 0, declined: 0, undecided: 0, pending: 1 }),
    ]);
  });

  it('gives each side its declined and pending too', async () => {
    const { eventId } = await twoFamilies();

    const headcount = await operations.headcount(eventId);

    // The fixture's first guest is on side A; the three added here have no side.
    expect(headcount.bySide.find((side) => side.side === 'SIDE_A')).toMatchObject({ invited: 1, attending: 1, pending: 0 });
    expect(headcount.bySide.find((side) => side.side === 'UNKNOWN')).toMatchObject({
      invited: 3,
      attending: 1,
      declined: 1,
      undecided: 0,
      pending: 1,
    });
  });

  it('tracks responses day by day in the event’s time zone, with the running rate', async () => {
    const { eventId } = await twoFamilies();

    const headcount = await operations.headcount(eventId);

    expect(headcount.trend).toEqual([
      { date: '2027-05-01', responses: 1, cumulative: 1, responseRate: 25 },
      { date: '2027-05-02', responses: 1, cumulative: 2, responseRate: 50 },
      { date: '2027-05-03', responses: 1, cumulative: 3, responseRate: 75 },
    ]);
  });
});
