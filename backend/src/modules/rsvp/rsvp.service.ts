import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Guest, Prisma, RsvpStatus } from '@prisma/client';
import { newGuestToken } from '../guests/guest-token';
import { LockedHousehold, lockHousehold } from '../guests/household-lock';
import { PrismaService } from '../../prisma/prisma.service';
import { RsvpConfirmerService } from '../invitations/sending/rsvp-confirmer.service';
import { Answer, AnswerableQuestion, answersProblem, unansweredRequired } from './answers';
import { MemberAnswerDto, PartyMemberDto, SubmitRsvpDto } from './dto/submit-rsvp.dto';
import { membersProblem, newPartyMembers } from './household-answers';

type Tx = Prisma.TransactionClient;

/** What one RSVP row may be told. Omitted fields keep their value. */
type RsvpFields = Partial<
  Pick<Prisma.RsvpUncheckedCreateInput, 'dietary' | 'dietaryNotes' | 'drinkPreference' | 'songRequest' | 'message'>
> & { status: RsvpStatus };

interface HouseholdMember {
  id: string;
  firstName: string;
  lastName: string | null;
  addedByGuest: boolean;
}

@Injectable()
export class RsvpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly confirmer: RsvpConfirmerService,
  ) {}

  /**
   * A household responds through one link. Every field here has a declared
   * downstream consumer (spec §5.3): dietary feeds the catering sheet, drink
   * the bar sheet, song the playlist, attribution the seating constraints.
   *
   * Whoever holds the link answers for everyone named in the household —
   * decided 8 October 2026, because families split ("we're coming, grandma
   * can't travel") and catering and seating count people. Before that, only
   * the person who opened the link was recorded and the rest of the family
   * stayed PENDING forever.
   *
   * Safe to send again: plus-ones are matched by name, omitted fields keep
   * their value, and the time of the first answer is kept.
   */
  async submit(slug: string, token: string, dto: SubmitRsvpDto) {
    const guest = await this.loadGuest(slug, token);
    const questions = await this.loadAcceptingQuestions(slug);
    assertNoProblem(answersProblem(questions, dto.answers ?? []));
    assertNoProblem(memberAnswersProblem(questions, dto.members ?? []));

    const result = await this.prisma.$transaction(async (tx) => {
      // Counted under the household's lock, not from the guest loaded above:
      // the host may be adding someone to this household at the same moment.
      const household = await lockHousehold(tx, guest.eventId, guest.householdId);
      const members = await tx.guest.findMany({
        where: { householdId: guest.householdId },
        select: { id: true, firstName: true, lastName: true, addedByGuest: true },
      });
      const party = newPartyMembers(members, dto.party ?? []);
      assertHouseholdCapacity(household, party.length);
      assertNoProblem(membersProblem(new Set(members.map((m) => m.id)), guest.id, memberIds(dto)));
      await this.assertRequiredAnswered(tx, guest.id, questions, dto);

      await this.applyGuestChanges(tx, guest, dto);
      const rsvp = await recordAnswer(tx, guest.id, respondentFields(dto));
      await this.saveCustomAnswers(tx, rsvp.id, dto);
      await this.addPartyMembers(tx, guest, dto, party);
      await this.answerForMembers(tx, members, guest.id, dto);

      return {
        status: rsvp.status,
        respondedAt: rsvp.respondedAt,
        partyAdded: party.length,
        membersAnswered: dto.members?.length ?? 0,
        seatsRemaining: household.seatsAllotted - (household.namedGuests + party.length),
      };
    });

    // After the commit, never inside it: a confirmation for an answer that
    // then rolled back would tell the guest something untrue.
    await this.confirmer.confirm(guest.id, result.status);
    return result;
  }

  /** The guest's answer, and everyone in the household they can answer for. */
  async getForGuest(slug: string, token: string) {
    const guest = await this.prisma.guest.findFirst({
      where: { token, event: { invitation: { slug } } },
      include: {
        rsvp: { include: { answers: { select: { questionId: true, value: true } } } },
        household: {
          include: {
            guests: {
              orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
              select: { id: true, firstName: true, lastName: true, addedByGuest: true, rsvp: true },
            },
          },
        },
      },
    });
    if (!guest) throw new NotFoundException('Invitation link not recognised');

    return {
      guest: { id: guest.id, firstName: guest.firstName, lastName: guest.lastName },
      household: {
        name: guest.household.name,
        seatsAllotted: guest.household.seatsAllotted,
        members: guest.household.guests
          .filter((member) => member.id !== guest.id)
          .map((member) => ({
            id: member.id,
            firstName: member.firstName,
            lastName: member.lastName,
            addedByGuest: member.addedByGuest,
            status: member.rsvp?.status ?? RsvpStatus.PENDING,
            dietary: member.rsvp?.dietary ?? [],
            dietaryNotes: member.rsvp?.dietaryNotes ?? null,
          })),
      },
      rsvp: guest.rsvp ?? { status: RsvpStatus.PENDING, answers: [] },
    };
  }

  // ── guards ───────────────────────────────────────────────────────────

  private async loadGuest(slug: string, token: string): Promise<Guest> {
    const guest = await this.prisma.guest.findFirst({
      where: { token, event: { invitation: { slug } } },
    });
    if (!guest) throw new NotFoundException('Invitation link not recognised');
    return guest;
  }

  /** The invitation's questions, if it is taking answers. */
  private async loadAcceptingQuestions(slug: string): Promise<AnswerableQuestion[]> {
    const invitation = await this.prisma.invitation.findUnique({
      where: { slug },
      select: {
        status: true,
        expiresAt: true,
        questions: { select: { id: true, type: true, required: true, options: true } },
      },
    });

    if (invitation?.status !== 'PUBLISHED') {
      throw new BadRequestException('This invitation is not accepting responses');
    }
    if (invitation.expiresAt && invitation.expiresAt < new Date()) {
      throw new BadRequestException('This invitation has closed');
    }
    return invitation.questions;
  }

  private async assertRequiredAnswered(
    tx: Tx,
    guestId: string,
    questions: AnswerableQuestion[],
    dto: SubmitRsvpDto,
  ): Promise<void> {
    const earlier = await tx.rsvpAnswer.findMany({
      where: { rsvp: { guestId } },
      select: { questionId: true },
    });
    const answered = new Set([...earlier, ...(dto.answers ?? [])].map((answer) => answer.questionId));

    const missing = unansweredRequired(questions, answered, dto.status);
    if (missing) throw new BadRequestException(`answers: ${missing.id} is required for a guest who is coming`);

    await this.assertMembersAnsweredRequired(tx, questions, dto.members ?? []);
  }

  /** The same rule for each member answered for: a required question binds everyone who is coming. */
  private async assertMembersAnsweredRequired(
    tx: Tx,
    questions: AnswerableQuestion[],
    members: MemberAnswerDto[],
  ): Promise<void> {
    if (!questions.some((question) => question.required) || members.length === 0) return;

    const earlier = await tx.rsvpAnswer.findMany({
      where: { rsvp: { guestId: { in: members.map((member) => member.guestId) } } },
      select: { questionId: true, rsvp: { select: { guestId: true } } },
    });

    for (const member of members) {
      const answered = new Set([
        ...earlier.filter((answer) => answer.rsvp.guestId === member.guestId).map((answer) => answer.questionId),
        ...(member.answers ?? []).map((answer) => answer.questionId),
      ]);
      const missing = unansweredRequired(questions, answered, member.status);
      if (missing) {
        throw new BadRequestException(`members: ${member.guestId} must answer ${missing.id}, as they are coming`);
      }
    }
  }

  // ── writes ───────────────────────────────────────────────────────────

  private async applyGuestChanges(tx: Tx, guest: Guest, dto: SubmitRsvpDto): Promise<void> {
    if (!dto.attribution && !dto.locale) return;

    await tx.guest.update({
      where: { id: guest.id },
      data: {
        ...(dto.attribution ? { attribution: dto.attribution } : {}),
        ...(dto.locale ? { locale: dto.locale } : {}),
      },
    });
  }

  /** Named plus-ones become real household members, inheriting attribution. */
  private async addPartyMembers(
    tx: Tx,
    guest: Guest,
    dto: SubmitRsvpDto,
    party: PartyMemberDto[],
  ): Promise<void> {
    for (const member of party) {
      await tx.guest.create({
        data: {
          eventId: guest.eventId,
          householdId: guest.householdId,
          firstName: member.firstName.trim(),
          lastName: member.lastName?.trim() || null,
          token: newGuestToken(),
          attribution: dto.attribution ?? guest.attribution,
          locale: dto.locale ?? guest.locale,
          addedByGuest: true,
          rsvp: { create: { status: dto.status, respondedAt: new Date() } },
        },
      });
    }
  }

  /**
   * Everyone else in the household. Those given an answer get it. Plus-ones
   * the guests added themselves follow the respondent unless answered for —
   * a guest who switches to "declined" is not bringing their plus-one. People
   * the host named, and not mentioned, keep their own answer.
   */
  private async answerForMembers(
    tx: Tx,
    members: HouseholdMember[],
    respondentId: string,
    dto: SubmitRsvpDto,
  ): Promise<void> {
    const explicit = new Map((dto.members ?? []).map((answer) => [answer.guestId, answer]));

    for (const answer of explicit.values()) {
      const rsvp = await recordAnswer(tx, answer.guestId, memberFields(answer));
      await saveAnswers(tx, rsvp.id, answer.answers ?? []);
    }

    const followers = members.filter(
      (member) => member.addedByGuest && member.id !== respondentId && !explicit.has(member.id),
    );
    for (const follower of followers) {
      await recordAnswer(tx, follower.id, { status: dto.status });
    }
  }

  private async saveCustomAnswers(tx: Tx, rsvpId: string, dto: SubmitRsvpDto): Promise<void> {
    await saveAnswers(tx, rsvpId, dto.answers ?? []);
  }
}

async function saveAnswers(tx: Tx, rsvpId: string, answers: Answer[]): Promise<void> {
  for (const answer of answers) {
    const value = answer.value as Prisma.InputJsonValue;
    await tx.rsvpAnswer.upsert({
      where: { rsvpId_questionId: { rsvpId, questionId: answer.questionId } },
      create: { rsvpId, questionId: answer.questionId, value },
      update: { value },
    });
  }
}

/** Each member's answers, checked as the respondent's are, naming the member. */
function memberAnswersProblem(questions: AnswerableQuestion[], members: MemberAnswerDto[]): string | null {
  for (const member of members) {
    const problem = answersProblem(questions, member.answers ?? []);
    if (problem) return `members: ${member.guestId} ${problem}`;
  }
  return null;
}

/**
 * Writes one person's answer. Omitted fields keep their value, and the time
 * of the first answer is kept: an edit is not a new response, and the
 * response-rate trend reads when people first answered.
 */
async function recordAnswer(tx: Tx, guestId: string, fields: RsvpFields) {
  const existing = await tx.rsvp.findUnique({ where: { guestId }, select: { respondedAt: true } });
  const respondedAt = existing?.respondedAt ?? new Date();

  return tx.rsvp.upsert({
    where: { guestId },
    create: { guestId, ...fields, respondedAt },
    update: { ...fields, respondedAt },
  });
}

function respondentFields(dto: SubmitRsvpDto): RsvpFields {
  return withoutUndefined({
    status: dto.status,
    dietary: dto.dietary,
    dietaryNotes: dto.dietaryNotes,
    drinkPreference: dto.drinkPreference,
    songRequest: dto.songRequest,
    message: dto.message,
  });
}

function memberFields(answer: MemberAnswerDto): RsvpFields {
  return withoutUndefined({ status: answer.status, dietary: answer.dietary, dietaryNotes: answer.dietaryNotes });
}

function withoutUndefined<T extends object>(fields: T): T {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as T;
}

function memberIds(dto: SubmitRsvpDto): string[] {
  return (dto.members ?? []).map((answer) => answer.guestId);
}

function assertNoProblem(problem: string | null): void {
  if (problem) throw new BadRequestException(problem);
}

function assertHouseholdCapacity(household: LockedHousehold, incoming: number): void {
  const allotted = household.seatsAllotted;
  const alreadyNamed = household.namedGuests;

  if (alreadyNamed + incoming > allotted) {
    throw new BadRequestException(
      `This invitation allows ${allotted} guest(s); ` +
        `${alreadyNamed} already named and ${incoming} more were submitted`,
    );
  }
}
