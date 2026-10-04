import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RsvpStatus } from '@prisma/client';
import { customAlphabet } from 'nanoid';
import { PrismaService } from '../../prisma/prisma.service';
import { SubmitRsvpDto } from './dto/submit-rsvp.dto';

const guestToken = customAlphabet('23456789abcdefghjkmnpqrstuvwxyz', 12);

@Injectable()
export class RsvpService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A guest responds. Everything here has a declared downstream consumer
   * (spec §5.3) — dietary feeds the catering sheet, drink the bar sheet, song
   * the playlist, attribution the seating constraints.
   *
   * Named party members become real Guest rows in the same household rather
   * than a free-text blob, which is what makes seating and check-in work for
   * plus-ones (spec §4).
   */
  async submit(slug: string, token: string, dto: SubmitRsvpDto) {
    const guest = await this.prisma.guest.findFirst({
      where: { token, event: { invitation: { slug } } },
      include: { household: { include: { guests: true } }, event: true },
    });

    if (!guest) throw new NotFoundException('Invitation link not recognised');

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

    const newMembers = dto.party ?? [];
    const alreadyUsed = guest.household.guests.length;
    if (alreadyUsed + newMembers.length > guest.household.seatsAllotted) {
      throw new BadRequestException(
        `This invitation allows ${guest.household.seatsAllotted} guest(s); ` +
          `${alreadyUsed} already named and ${newMembers.length} more were submitted`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.attribution || dto.locale) {
        await tx.guest.update({
          where: { id: guest.id },
          data: {
            ...(dto.attribution ? { attribution: dto.attribution } : {}),
            ...(dto.locale ? { locale: dto.locale } : {}),
          },
        });
      }

      // Named plus-ones become household members, inheriting attribution.
      for (const member of newMembers) {
        await tx.guest.create({
          data: {
            eventId: guest.eventId,
            householdId: guest.householdId,
            firstName: member.firstName,
            lastName: member.lastName,
            token: guestToken(),
            attribution: dto.attribution ?? guest.attribution,
            locale: dto.locale ?? guest.locale,
            addedByGuest: true,
            rsvp: { create: { status: dto.status, respondedAt: new Date() } },
          },
        });
      }

      const payload = {
        status: dto.status,
        dietary: dto.dietary ?? [],
        dietaryNotes: dto.dietaryNotes ?? null,
        drinkPreference: dto.drinkPreference ?? null,
        songRequest: dto.songRequest ?? null,
        message: dto.message ?? null,
        respondedAt: new Date(),
      } satisfies Prisma.RsvpUncheckedUpdateInput;

      const rsvp = await tx.rsvp.upsert({
        where: { guestId: guest.id },
        create: { guestId: guest.id, ...payload },
        update: payload,
      });

      for (const answer of dto.answers ?? []) {
        await tx.rsvpAnswer.upsert({
          where: { rsvpId_questionId: { rsvpId: rsvp.id, questionId: answer.questionId } },
          create: {
            rsvpId: rsvp.id,
            questionId: answer.questionId,
            value: answer.value as Prisma.InputJsonValue,
          },
          update: { value: answer.value as Prisma.InputJsonValue },
        });
      }

      return {
        status: rsvp.status,
        respondedAt: rsvp.respondedAt,
        partyAdded: newMembers.length,
        seatsRemaining:
          guest.household.seatsAllotted - (alreadyUsed + newMembers.length),
      };
    });
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
}
