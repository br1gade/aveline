import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RsvpStatus } from '@prisma/client';
import { customAlphabet } from 'nanoid';
import { PrismaService } from '../../prisma/prisma.service';
import { RsvpConfirmerService } from '../invitations/sending/rsvp-confirmer.service';
import { PartyMemberDto, SubmitRsvpDto } from './dto/submit-rsvp.dto';

const newGuestToken = customAlphabet('23456789abcdefghjkmnpqrstuvwxyz', 12);

type RespondingGuest = Prisma.GuestGetPayload<{
  include: { household: { include: { guests: true } }; event: true };
}>;

@Injectable()
export class RsvpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly confirmer: RsvpConfirmerService,
  ) {}

  /**
   * A guest responds. Every field here has a declared downstream consumer
   * (spec §5.3): dietary feeds the catering sheet, drink the bar sheet, song
   * the playlist, attribution the seating constraints.
   */
  async submit(slug: string, token: string, dto: SubmitRsvpDto) {
    const guest = await this.loadGuest(slug, token);
    await this.assertInvitationAccepting(slug);

    const newMembers = dto.party ?? [];
    this.assertHouseholdCapacity(guest, newMembers.length);

    const result = await this.prisma.$transaction(async (tx) => {
      await this.applyGuestChanges(tx, guest, dto);
      await this.addPartyMembers(tx, guest, dto, newMembers);
      const rsvp = await this.upsertRsvp(tx, guest.id, dto);
      await this.saveCustomAnswers(tx, rsvp.id, dto);

      const namedTotal = guest.household.guests.length + newMembers.length;
      return {
        status: rsvp.status,
        respondedAt: rsvp.respondedAt,
        partyAdded: newMembers.length,
        seatsRemaining: guest.household.seatsAllotted - namedTotal,
      };
    });

    // After the commit, never inside it: a confirmation for an answer that
    // then rolled back would tell the guest something untrue.
    await this.confirmer.confirm(guest.id, result.status);
    return result;
  }

  async getForGuest(slug: string, token: string) {
    const guest = await this.prisma.guest.findFirst({
      where: { token, event: { invitation: { slug } } },
      include: { rsvp: { include: { answers: true } }, household: true },
    });
    if (!guest) throw new NotFoundException('Invitation link not recognised');

    return {
      guest: { id: guest.id, firstName: guest.firstName, lastName: guest.lastName },
      household: { name: guest.household.name, seatsAllotted: guest.household.seatsAllotted },
      rsvp: guest.rsvp ?? { status: RsvpStatus.PENDING },
    };
  }

  // ── guards ───────────────────────────────────────────────────────────

  private async loadGuest(slug: string, token: string): Promise<RespondingGuest> {
    const guest = await this.prisma.guest.findFirst({
      where: { token, event: { invitation: { slug } } },
      include: { household: { include: { guests: true } }, event: true },
    });
    if (!guest) throw new NotFoundException('Invitation link not recognised');
    return guest;
  }

  private async assertInvitationAccepting(slug: string): Promise<void> {
    const invitation = await this.prisma.invitation.findUnique({
      where: { slug },
      select: { status: true, expiresAt: true },
    });

    if (invitation?.status !== 'PUBLISHED') {
      throw new BadRequestException('This invitation is not accepting responses');
    }
    if (invitation.expiresAt && invitation.expiresAt < new Date()) {
      throw new BadRequestException('This invitation has closed');
    }
  }

  private assertHouseholdCapacity(guest: RespondingGuest, incoming: number): void {
    const alreadyNamed = guest.household.guests.length;
    const allotted = guest.household.seatsAllotted;

    if (alreadyNamed + incoming > allotted) {
      throw new BadRequestException(
        `This invitation allows ${allotted} guest(s); ` +
          `${alreadyNamed} already named and ${incoming} more were submitted`,
      );
    }
  }

  // ── writes ───────────────────────────────────────────────────────────

  private async applyGuestChanges(
    tx: Prisma.TransactionClient,
    guest: RespondingGuest,
    dto: SubmitRsvpDto,
  ): Promise<void> {
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
    tx: Prisma.TransactionClient,
    guest: RespondingGuest,
    dto: SubmitRsvpDto,
    members: PartyMemberDto[],
  ): Promise<void> {
    for (const member of members) {
      await tx.guest.create({
        data: {
          eventId: guest.eventId,
          householdId: guest.householdId,
          firstName: member.firstName,
          lastName: member.lastName,
          token: newGuestToken(),
          attribution: dto.attribution ?? guest.attribution,
          locale: dto.locale ?? guest.locale,
          addedByGuest: true,
          rsvp: { create: { status: dto.status, respondedAt: new Date() } },
        },
      });
    }
  }

  private upsertRsvp(tx: Prisma.TransactionClient, guestId: string, dto: SubmitRsvpDto) {
    const payload = {
      status: dto.status,
      dietary: dto.dietary ?? [],
      dietaryNotes: dto.dietaryNotes ?? null,
      drinkPreference: dto.drinkPreference ?? null,
      songRequest: dto.songRequest ?? null,
      message: dto.message ?? null,
      respondedAt: new Date(),
    };

    return tx.rsvp.upsert({
      where: { guestId },
      create: { guestId, ...payload },
      update: payload,
    });
  }

  private async saveCustomAnswers(
    tx: Prisma.TransactionClient,
    rsvpId: string,
    dto: SubmitRsvpDto,
  ): Promise<void> {
    for (const answer of dto.answers ?? []) {
      const value = answer.value as Prisma.InputJsonValue;
      await tx.rsvpAnswer.upsert({
        where: { rsvpId_questionId: { rsvpId, questionId: answer.questionId } },
        create: { rsvpId, questionId: answer.questionId, value },
        update: { value },
      });
    }
  }
}
