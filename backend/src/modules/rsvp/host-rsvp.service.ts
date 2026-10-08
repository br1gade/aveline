import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RsvpConfirmerService } from '../invitations/sending/rsvp-confirmer.service';
import { recordAnswer, saveAnswers, withoutUndefined } from './answer-writes';
import { answersProblem } from './answers';
import { HostRsvpDto } from './dto/host-rsvp.dto';

/**
 * A host recording a guest's answer for them.
 *
 * The grandmother who phones it in: until now the only way an answer was
 * recorded was the guest's own link, so the host had nowhere to put it and
 * the headcount stayed wrong. The same rules as the guest's form — answers
 * checked against their questions, omitted fields kept — with two
 * differences. A required question is not enforced, because the host may not
 * know her meal yet. And the guest is not messaged unless the host asks:
 * she told them herself, and a confirmation would be a surprise.
 *
 * Who recorded it is in the audit trail, like every write a host makes.
 */
@Injectable()
export class HostRsvpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly confirmer: RsvpConfirmerService,
  ) {}

  async record(eventId: string, guestId: string, dto: HostRsvpDto) {
    const guest = await this.prisma.guest.findFirst({
      where: { id: guestId, eventId },
      select: {
        anonymizedAt: true,
        event: { select: { invitation: { select: { questions: { select: { id: true, type: true, required: true, options: true } } } } } },
      },
    });
    if (!guest) throw new NotFoundException(`No guest ${guestId} on this event`);
    if (guest.anonymizedAt) throw new BadRequestException("This guest's details were erased at their request");

    const problem = answersProblem(guest.event.invitation?.questions ?? [], dto.answers ?? []);
    if (problem) throw new BadRequestException(problem);

    const rsvp = await this.prisma.$transaction(async (tx) => {
      const recorded = await recordAnswer(
        tx,
        guestId,
        withoutUndefined({
          status: dto.status,
          dietary: dto.dietary,
          dietaryNotes: dto.dietaryNotes,
          drinkPreference: dto.drinkPreference,
          songRequest: dto.songRequest,
          message: dto.message,
        }),
      );
      await saveAnswers(tx, recorded.id, dto.answers ?? []);
      return recorded;
    });

    // After the commit, and only when asked. Never fails the recording.
    if (dto.notifyGuest) await this.confirmer.confirm(guestId, rsvp.status);

    return {
      status: rsvp.status,
      respondedAt: rsvp.respondedAt,
      dietary: rsvp.dietary,
      dietaryNotes: rsvp.dietaryNotes,
      drinkPreference: rsvp.drinkPreference,
      songRequest: rsvp.songRequest,
      message: rsvp.message,
    };
  }
}
