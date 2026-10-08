import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageChannel, PrismaClient, QuestionType, RsvpStatus } from '@prisma/client';
import { ConsoleTransport } from '../../src/modules/communications/channels/console.transport';
import { MessageTransport } from '../../src/modules/communications/channels/message-channel';
import { CommunicationsService } from '../../src/modules/communications/communications.service';
import { GuestChannelsService } from '../../src/modules/communications/guest-channels.service';
import { SuppressionService } from '../../src/modules/communications/suppression.service';
import { RsvpConfirmerService } from '../../src/modules/invitations/sending/rsvp-confirmer.service';
import { RsvpService } from '../../src/modules/rsvp/rsvp.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

/**
 * A household answers together: one invitation link, one form, every named
 * person on it. These cover what used to go wrong — the rest of the family
 * left PENDING forever, plus-ones duplicated by a retry and stranded by a
 * changed answer, earlier answers wiped by an edit, and custom questions
 * that could not be answered at all.
 */
describe('Household RSVP (integration)', () => {
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
      ({ get: () => undefined }) as unknown as ConfigService,
    );
    service = new RsvpService(prismaService, confirmer);
  });

  beforeEach(() => resetTestDatabase());
  afterAll(() => disconnectTestDatabase());

  /** Armen holds the link; Lusine was imported with him and has no link of her own in use. */
  const petrosyans = async (seatsAllotted = 4) => {
    const seeded = await seedEvent(prisma, { seatsAllotted });
    const lusine = await prisma.guest.create({
      data: {
        eventId: seeded.eventId,
        householdId: seeded.householdId,
        firstName: 'Lusine',
        lastName: 'Petrosyan',
        token: `lusine-${seeded.slug}`,
        rsvp: { create: {} },
      },
    });
    return { ...seeded, lusineId: lusine.id };
  };

  const rsvpOf = (guestId: string) => prisma.rsvp.findUniqueOrThrow({ where: { guestId } });
  const membersNamed = (householdId: string, firstName: string) =>
    prisma.guest.findMany({ where: { householdId, firstName: { equals: firstName, mode: 'insensitive' } } });

  describe('answering for the household (decided 8 October 2026: per member, one form)', () => {
    it('records each named member’s own answer from one submission', async () => {
      const { slug, primaryGuestToken, lusineId } = await petrosyans();

      const result = await service.submit(slug, primaryGuestToken, {
        status: RsvpStatus.ATTENDING,
        members: [{ guestId: lusineId, status: RsvpStatus.DECLINED, dietary: ['vegan'] }],
      });

      expect(result.membersAnswered).toBe(1);
      const lusine = await rsvpOf(lusineId);
      expect(lusine).toMatchObject({ status: RsvpStatus.DECLINED, dietary: ['vegan'] });
      expect(lusine.respondedAt).toBeInstanceOf(Date);
    });

    it('leaves a member who was not mentioned as they were', async () => {
      const { slug, primaryGuestToken, lusineId } = await petrosyans();

      await service.submit(slug, primaryGuestToken, { status: RsvpStatus.ATTENDING });

      expect((await rsvpOf(lusineId)).status).toBe(RsvpStatus.PENDING);
    });

    it('refuses someone from another household, naming the field', async () => {
      const { slug, primaryGuestToken } = await petrosyans();
      const stranger = await seedEvent(prisma);
      const strangerGuest = await prisma.guest.findFirstOrThrow({ where: { householdId: stranger.householdId } });

      await expect(
        service.submit(slug, primaryGuestToken, {
          status: RsvpStatus.ATTENDING,
          members: [{ guestId: strangerGuest.id, status: RsvpStatus.ATTENDING }],
        }),
      ).rejects.toThrow(/^members: /);
    });

    it('refuses the respondent listed again as a member', async () => {
      const { slug, primaryGuestToken } = await petrosyans();
      const armen = await prisma.guest.findFirstOrThrow({ where: { token: primaryGuestToken } });

      await expect(
        service.submit(slug, primaryGuestToken, {
          status: RsvpStatus.ATTENDING,
          members: [{ guestId: armen.id, status: RsvpStatus.DECLINED }],
        }),
      ).rejects.toThrow(/^members: /);
    });
  });

  describe('plus-ones', () => {
    it('adds a plus-one once, however many times the same answer is sent', async () => {
      const { slug, primaryGuestToken, householdId } = await petrosyans();
      const answer = { status: RsvpStatus.ATTENDING, party: [{ firstName: 'Narek', lastName: 'Petrosyan' }] };

      const first = await service.submit(slug, primaryGuestToken, answer);
      const retry = await service.submit(slug, primaryGuestToken, answer);

      expect(first.partyAdded).toBe(1);
      expect(retry.partyAdded).toBe(0);
      expect(await membersNamed(householdId, 'Narek')).toHaveLength(1);
    });

    it('recognises the same person despite capitals and spacing', async () => {
      const { slug, primaryGuestToken, householdId } = await petrosyans();

      await service.submit(slug, primaryGuestToken, { status: RsvpStatus.ATTENDING, party: [{ firstName: 'Narek' }] });
      await service.submit(slug, primaryGuestToken, { status: RsvpStatus.ATTENDING, party: [{ firstName: ' narek ' }] });

      expect(await membersNamed(householdId, 'narek')).toHaveLength(1);
    });

    // A retry must not fail on the capacity its own first attempt used.
    it('does not count a plus-one already added against the seats again', async () => {
      const { slug, primaryGuestToken } = await petrosyans(3);
      const answer = { status: RsvpStatus.ATTENDING, party: [{ firstName: 'Narek' }] };

      await service.submit(slug, primaryGuestToken, answer);
      await expect(service.submit(slug, primaryGuestToken, answer)).resolves.toMatchObject({ seatsRemaining: 0 });
    });

    it('follows the respondent’s changed answer', async () => {
      const { slug, primaryGuestToken, householdId } = await petrosyans();
      await service.submit(slug, primaryGuestToken, { status: RsvpStatus.ATTENDING, party: [{ firstName: 'Narek' }] });

      await service.submit(slug, primaryGuestToken, { status: RsvpStatus.DECLINED });

      const [narek] = await membersNamed(householdId, 'Narek');
      expect((await rsvpOf(narek.id)).status).toBe(RsvpStatus.DECLINED);
    });

    it('takes a plus-one’s own answer over the respondent’s when one is given', async () => {
      const { slug, primaryGuestToken, householdId } = await petrosyans();
      await service.submit(slug, primaryGuestToken, { status: RsvpStatus.ATTENDING, party: [{ firstName: 'Narek' }] });
      const [narek] = await membersNamed(householdId, 'Narek');

      await service.submit(slug, primaryGuestToken, {
        status: RsvpStatus.ATTENDING,
        members: [{ guestId: narek.id, status: RsvpStatus.DECLINED }],
      });

      expect((await rsvpOf(narek.id)).status).toBe(RsvpStatus.DECLINED);
    });
  });

  describe('editing an answer', () => {
    it('keeps what was said before when a field is left out', async () => {
      const { slug, primaryGuestToken } = await petrosyans();
      await service.submit(slug, primaryGuestToken, {
        status: RsvpStatus.ATTENDING,
        dietaryNotes: 'severe nut allergy',
        songRequest: 'Sirun Yar',
      });

      await service.submit(slug, primaryGuestToken, { status: RsvpStatus.UNDECIDED });

      const armen = await prisma.guest.findFirstOrThrow({ where: { token: primaryGuestToken }, include: { rsvp: true } });
      expect(armen.rsvp).toMatchObject({
        status: RsvpStatus.UNDECIDED,
        dietaryNotes: 'severe nut allergy',
        songRequest: 'Sirun Yar',
      });
    });

    // The response-rate trend reads when people first answered.
    it('keeps the time of the first answer', async () => {
      const { slug, primaryGuestToken } = await petrosyans();
      const first = await service.submit(slug, primaryGuestToken, { status: RsvpStatus.ATTENDING });

      const second = await service.submit(slug, primaryGuestToken, { status: RsvpStatus.DECLINED });

      expect(second.respondedAt).toEqual(first.respondedAt);
    });
  });

  describe('custom questions', () => {
    const withQuestions = async () => {
      const seeded = await petrosyans();
      const invitation = await prisma.invitation.findUniqueOrThrow({ where: { slug: seeded.slug } });
      const question = (type: QuestionType, extra: Record<string, unknown> = {}) =>
        prisma.rsvpQuestion.create({
          data: { invitationId: invitation.id, type, prompt: { en: String(type) }, ...extra },
        });
      const meal = await question(QuestionType.SINGLE_CHOICE, {
        required: true,
        options: { en: ['Meat', 'Fish'], hy: ['Միս', 'Ձուկ'] },
      });
      const extras = await question(QuestionType.MULTI_CHOICE, { options: { en: ['Shuttle', 'Hotel', 'Childcare'] } });
      const note = await question(QuestionType.TEXT);
      const children = await question(QuestionType.BOOLEAN);
      return { ...seeded, meal, extras, note, children };
    };

    const answersOf = async (token: string) => {
      const guest = await prisma.guest.findFirstOrThrow({
        where: { token },
        include: { rsvp: { include: { answers: true } } },
      });
      return Object.fromEntries((guest.rsvp?.answers ?? []).map((a) => [a.questionId, a.value]));
    };

    it('stores each kind of answer — a choice by its position, so every language counts the same', async () => {
      const { slug, primaryGuestToken, meal, extras, note, children } = await withQuestions();

      await service.submit(slug, primaryGuestToken, {
        status: RsvpStatus.ATTENDING,
        answers: [
          { questionId: meal.id, value: 1 },
          { questionId: extras.id, value: [0, 2] },
          { questionId: note.id, value: 'We arrive late' },
          { questionId: children.id, value: true },
        ],
      });

      expect(await answersOf(primaryGuestToken)).toEqual({
        [meal.id]: 1,
        [extras.id]: [0, 2],
        [note.id]: 'We arrive late',
        [children.id]: true,
      });
    });

    it.each([
      ['a choice past the end of the list', 'meal', 2],
      ['a choice given as text', 'meal', 'Fish'],
      ['the same choice twice', 'extras', [1, 1]],
      ['a yes/no given as text', 'children', 'yes'],
      ['text given as a number', 'note', 42],
    ] as const)('refuses %s, naming answers and changing nothing', async (_label, key, value) => {
      const setup = await withQuestions();

      await expect(
        service.submit(setup.slug, setup.primaryGuestToken, {
          status: RsvpStatus.ATTENDING,
          answers: [
            { questionId: setup.meal.id, value: 0 },
            { questionId: setup[key].id, value },
          ],
        }),
      ).rejects.toThrow(/^answers: /);
      expect((await rsvpOf((await prisma.guest.findFirstOrThrow({ where: { token: setup.primaryGuestToken } })).id)).status).toBe(
        RsvpStatus.PENDING,
      );
    });

    // Question ids are public in the invitation payload.
    it('refuses an answer to another invitation’s question', async () => {
      const { slug, primaryGuestToken } = await withQuestions();
      const other = await withQuestions();

      await expect(
        service.submit(slug, primaryGuestToken, {
          status: RsvpStatus.DECLINED,
          answers: [{ questionId: other.note.id, value: 'hello' }],
        }),
      ).rejects.toThrow(/^answers: /);
    });

    it('requires a required question from someone who is coming', async () => {
      const { slug, primaryGuestToken } = await withQuestions();

      await expect(
        service.submit(slug, primaryGuestToken, { status: RsvpStatus.ATTENDING }),
      ).rejects.toThrow(BadRequestException);
    });

    it('does not ask someone who is not coming to choose a meal', async () => {
      const { slug, primaryGuestToken } = await withQuestions();

      await expect(service.submit(slug, primaryGuestToken, { status: RsvpStatus.DECLINED })).resolves.toMatchObject({
        status: RsvpStatus.DECLINED,
      });
    });

    // A meal is chosen per person, or the caterer counts households instead of plates.
    it('records each member’s own answers to the host’s questions', async () => {
      const { slug, primaryGuestToken, lusineId, meal } = await withQuestions();

      await service.submit(slug, primaryGuestToken, {
        status: RsvpStatus.ATTENDING,
        answers: [{ questionId: meal.id, value: 1 }],
        members: [{ guestId: lusineId, status: RsvpStatus.ATTENDING, answers: [{ questionId: meal.id, value: 0 }] }],
      });

      expect(await answersOf(primaryGuestToken)).toEqual({ [meal.id]: 1 });
      const lusine = await prisma.guest.findUniqueOrThrow({ where: { id: lusineId } });
      expect(await answersOf(lusine.token)).toEqual({ [meal.id]: 0 });
    });

    it('requires a required question from each member who is coming, naming members', async () => {
      const { slug, primaryGuestToken, lusineId, meal } = await withQuestions();

      await expect(
        service.submit(slug, primaryGuestToken, {
          status: RsvpStatus.ATTENDING,
          answers: [{ questionId: meal.id, value: 1 }],
          members: [{ guestId: lusineId, status: RsvpStatus.ATTENDING }],
        }),
      ).rejects.toThrow(/^members: /);
    });

    it('refuses a member’s answer that is not one of the options, naming members', async () => {
      const { slug, primaryGuestToken, lusineId, meal } = await withQuestions();

      await expect(
        service.submit(slug, primaryGuestToken, {
          status: RsvpStatus.DECLINED,
          members: [{ guestId: lusineId, status: RsvpStatus.DECLINED, answers: [{ questionId: meal.id, value: 'Fish' }] }],
        }),
      ).rejects.toThrow(/^members: /);
    });

    it('counts a required question answered in an earlier submission', async () => {
      const { slug, primaryGuestToken, meal } = await withQuestions();
      await service.submit(slug, primaryGuestToken, {
        status: RsvpStatus.ATTENDING,
        answers: [{ questionId: meal.id, value: 0 }],
      });

      await expect(
        service.submit(slug, primaryGuestToken, { status: RsvpStatus.ATTENDING, songRequest: 'Sirun Yar' }),
      ).resolves.toMatchObject({ status: RsvpStatus.ATTENDING });
    });
  });
});
