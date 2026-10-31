import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaClient, QuestionType, RsvpStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { CacheService } from '../../../src/infra/cache/cache.service';
import { AttendancePolicyService } from '../../../src/modules/events/attendance-policy.service';
import { VenuesService } from '../../../src/modules/design/venues.service';
import { RsvpConfirmerService } from '../../../src/modules/invitations/sending/rsvp-confirmer.service';
import { RsvpService } from '../../../src/modules/rsvp/rsvp.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { seedEvent } from '../../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

/**
 * The guest's RSVP against a real database: reconfirmation after a policy
 * change, required questions in per-venue mode, households answered from two
 * links at once, and a link rotated while its answer waits for a lock.
 */
describe('Guest flow coverage (integration)', () => {
  let prisma: PrismaClient;
  let policy: AttendancePolicyService;
  let rsvp: RsvpService;
  let venues: VenuesService;
  const cache = { invalidateInvitation: jest.fn().mockResolvedValue(undefined) } as unknown as CacheService;

  beforeAll(() => {
    prisma = testPrisma();
    const database = prisma as unknown as PrismaService;
    const confirmer = { confirm: jest.fn().mockResolvedValue(undefined) } as unknown as RsvpConfirmerService;
    policy = new AttendancePolicyService(database, cache);
    rsvp = new RsvpService(database, confirmer);
    venues = new VenuesService(database, cache);
  });
  beforeEach(() => resetTestDatabase());
  afterAll(() => disconnectTestDatabase());

  const change = async (eventId: string, mode: 'EVENT_WIDE' | 'PER_VENUE') => {
    const preview = await policy.preview(eventId, mode);
    return policy.change(eventId, { ...preview.request, transitionId: randomUUID() });
  };

  /** An event with two guest-facing venues: the seeded hall and a church. */
  const twoVenues = async (seatsAllotted = 4) => {
    const event = await seedEvent(prisma, { seatsAllotted });
    const hall = await prisma.venue.findFirstOrThrow({ where: { eventId: event.eventId } });
    const church = await venues.create(event.eventId, { role: 'CEREMONY', name: 'Church', address: '2 Test St' });
    return { ...event, hall, church };
  };
  const reconfirmation = async (slug: string, token: string) =>
    (await rsvp.getForGuest(slug, token)).attendance.needsReconfirmation;

  describe('needsReconfirmation', () => {
    it('stays true in per-venue mode until the last eligible venue is answered', async () => {
      const event = await twoVenues();
      await change(event.eventId, 'PER_VENUE');
      expect(await reconfirmation(event.slug, event.primaryGuestToken)).toBe(true);

      await rsvp.submit(event.slug, event.primaryGuestToken, { attendanceRevision: 2, venueAttendance: [{ venueId: event.hall.id, status: 'ATTENDING' }] });
      expect(await prisma.attendanceResponse.count({ where: { revision: 2, venueId: event.hall.id } })).toBe(1);
      expect(await reconfirmation(event.slug, event.primaryGuestToken)).toBe(true);

      await rsvp.submit(event.slug, event.primaryGuestToken, { attendanceRevision: 2, venueAttendance: [{ venueId: event.church.id, status: 'DECLINED' }] });
      expect(await reconfirmation(event.slug, event.primaryGuestToken)).toBe(false);
    });
    // Turning true again after a return to EVENT_WIDE, and false once answered, is journey-03's.
  });

  describe('required questions in per-venue mode', () => {
    const withRequiredQuestion = async () => {
      const event = await twoVenues();
      const invitation = await prisma.invitation.findUniqueOrThrow({ where: { slug: event.slug } });
      const question = await prisma.rsvpQuestion.create({
        data: { invitationId: invitation.id, type: QuestionType.TEXT, required: true, prompt: { en: 'Allergies?' } },
      });
      await change(event.eventId, 'PER_VENUE');
      return { ...event, question };
    };

    it('binds a person whose venue answers summarise to ATTENDING, naming the question', async () => {
      const event = await withRequiredQuestion();

      const attempt = rsvp.submit(event.slug, event.primaryGuestToken, {
        attendanceRevision: 2, venueAttendance: [{ venueId: event.hall.id, status: 'ATTENDING' }],
      });

      await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
      await expect(attempt).rejects.toThrow(new RegExp(`^answers: ${event.question.id} is required`));
      expect(await prisma.attendanceResponse.count({ where: { revision: 2 } })).toBe(0);
    });

    it.each([
      { summary: RsvpStatus.DECLINED, hall: RsvpStatus.DECLINED, church: RsvpStatus.DECLINED },
      { summary: RsvpStatus.UNDECIDED, hall: RsvpStatus.UNDECIDED, church: RsvpStatus.DECLINED },
      { summary: RsvpStatus.PENDING, hall: RsvpStatus.DECLINED, church: undefined },
    ])('does not bind a person whose venue answers summarise to $summary', async ({ summary, hall, church }) => {
      const event = await withRequiredQuestion();
      const venueAttendance = [{ venueId: event.hall.id, status: hall }, ...(church ? [{ venueId: event.church.id, status: church }] : [])];

      const result = await rsvp.submit(event.slug, event.primaryGuestToken, { attendanceRevision: 2, venueAttendance });

      expect(result.status).toBe(summary);
      expect(await prisma.attendanceResponse.count({ where: { revision: 2 } })).toBe(venueAttendance.length);
    });

    it('accepts an attending person who answers the required question', async () => {
      const event = await withRequiredQuestion();

      const result = await rsvp.submit(event.slug, event.primaryGuestToken, {
        attendanceRevision: 2,
        venueAttendance: [{ venueId: event.hall.id, status: 'ATTENDING' }],
        answers: [{ questionId: event.question.id, value: 'Nuts' }],
      });

      expect(result.status).toBe(RsvpStatus.ATTENDING);
    });

    it('binds a new plus-one attending a venue, naming them, and adds nobody', async () => {
      const event = await withRequiredQuestion();

      const attempt = rsvp.submit(event.slug, event.primaryGuestToken, {
        attendanceRevision: 2,
        venueAttendance: [{ venueId: event.hall.id, status: 'DECLINED' }],
        party: [{ firstName: 'Narek', venueAttendance: [{ venueId: event.church.id, status: 'ATTENDING' }] }],
      });

      await expect(attempt).rejects.toThrow(/^party: Narek must answer/);
      expect(await prisma.guest.count({ where: { householdId: event.householdId } })).toBe(1);
    });
  });

  describe('two links of one household answering at once', () => {
    const addMember = (event: { eventId: string; householdId: string; slug: string }, firstName: string) =>
      prisma.guest.create({
        data: { eventId: event.eventId, householdId: event.householdId, firstName, token: `${firstName.toLowerCase()}-${event.slug}`, rsvp: { create: {} } },
      });

    it('creates one plus-one when the same answer naming them is sent several times at once', async () => {
      const event = await seedEvent(prisma, { seatsAllotted: 4 });
      const answer = { status: RsvpStatus.ATTENDING, party: [{ firstName: 'Narek' }] };

      const results = await Promise.allSettled(
        Array.from({ length: 4 }, () => rsvp.submit(event.slug, event.primaryGuestToken, answer)),
      );

      expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
      expect(await prisma.guest.count({ where: { householdId: event.householdId, firstName: 'Narek', addedByGuest: true } })).toBe(1);
      expect(await prisma.guest.count({ where: { householdId: event.householdId } })).toBe(2);
    });

    it('lets only one of two members take the household’s last seat for their own plus-one', async () => {
      const event = await seedEvent(prisma, { seatsAllotted: 3 });
      const member = await addMember(event, 'Lusine');

      const results = await Promise.allSettled([
        rsvp.submit(event.slug, event.primaryGuestToken, { status: RsvpStatus.ATTENDING, party: [{ firstName: 'Narek' }] }),
        rsvp.submit(event.slug, member.token, { status: RsvpStatus.ATTENDING, party: [{ firstName: 'Gor' }] }),
      ]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(BadRequestException);
      const winner = results[0].status === 'fulfilled' ? 'Narek' : 'Gor';
      const added = await prisma.guest.findMany({ where: { householdId: event.householdId, addedByGuest: true }, select: { firstName: true } });
      expect(added).toEqual([{ firstName: winner }]);
      expect(await prisma.guest.count({ where: { householdId: event.householdId } })).toBe(3);
    });
  });

  it('refuses an RSVP whose link was rotated while it waited for the household lock, leaving it unanswered', async () => {
    const { slug, primaryGuestToken } = await seedEvent(prisma);
    let release = () => undefined as void;
    let locked = () => undefined as void;
    const isLocked = new Promise<void>((resolve) => { locked = resolve; });
    const canRelease = new Promise<void>((resolve) => { release = resolve; });
    const rotation = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM guests WHERE token = ${primaryGuestToken} FOR UPDATE`;
      locked();
      await canRelease;
      await tx.guest.update({ where: { token: primaryGuestToken }, data: { token: 'rotated-token' } });
    });
    await isLocked;

    const answer = rsvp.submit(slug, primaryGuestToken, { status: RsvpStatus.ATTENDING }).catch((error: unknown) => error);
    try {
      await waitForBlockedRsvp();
    } finally {
      release();
      await rotation;
    }

    expect(await answer).toBeInstanceOf(NotFoundException);
    const guest = await prisma.guest.findUniqueOrThrow({ where: { token: 'rotated-token' }, include: { rsvp: true } });
    expect(guest.rsvp).toMatchObject({ status: 'PENDING', respondedAt: null });
  });

  /**
   * Until the submission is parked on the guest row lock — so the rotation is
   * proven to land between the link's first read and its re-check under the
   * lock, rather than before the submission started.
   */
  async function waitForBlockedRsvp(): Promise<void> {
    for (let attempt = 0; attempt < 2000; attempt += 1) {
      const [row] = await prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%canRespond%FOR UPDATE%'`;
      if (row.count > 0) return;
    }
    throw new Error('the RSVP never waited on the guest row lock');
  }
});
