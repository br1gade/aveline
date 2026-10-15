import { assertAttendanceRevision, lockAttendancePolicy, normalizePersonAttendance } from './attendance/attendance-context';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RsvpConfirmerService } from '../invitations/sending/rsvp-confirmer.service';
import { recordAnswer, saveAnswers, withoutUndefined } from './answer-writes';
import { answersProblem } from './answers';
import { builtInAnswerProblem } from './rsvp-fields';
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

  async record(eventId: string, guestId: string, submitted: HostRsvpDto) {
    const invitation = await this.loadAnswerableInvitation(eventId, guestId);
    const problem =
      answersProblem(invitation?.questions ?? [], submitted.answers ?? []) ??
      builtInAnswerProblem(invitation?.rsvpFields, submitted);
    if (problem) throw new BadRequestException(problem);

    const rsvp = await this.prisma.$transaction(async (tx) => {
      const policy = await lockAttendancePolicy(tx, eventId);
      assertAttendanceRevision(policy, submitted.attendanceRevision);
      // Checked again under the guest's row lock: an erasure committing
      // between the check above and this write left the host's answer — their
      // dietary note, say — on an erased person (B87). Erasure updates the
      // same row, so the two now run one after the other.
      const [locked] = await tx.$queryRaw<{ anonymizedAt: Date | null }[]>`
        SELECT "anonymizedAt" FROM guests WHERE id = ${guestId} FOR UPDATE`;
      if (locked?.anonymizedAt) throw new BadRequestException("This guest's details were erased at their request");
      const earlier = await tx.attendanceResponse.findMany({ where: { guestId, revision: policy.attendanceRevision } });
      const dto = normalizePersonAttendance(policy, submitted, earlier);
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
        { policy, venueAttendance: dto.venueAttendance },
      );
      await saveAnswers(tx, recorded.id, submitted.answers ?? []);
      return { ...recorded, attendanceMode: policy.attendanceMode, attendanceRevision: policy.attendanceRevision };
    });

    // After the commit, and only when asked. Never fails the recording.
    if (submitted.notifyGuest) await this.confirmer.confirm(guestId, rsvp.status, rsvp.attendanceMode);

    return {
      attendanceMode: rsvp.attendanceMode,
      attendanceRevision: rsvp.attendanceRevision,
      status: rsvp.status,
      respondedAt: rsvp.respondedAt,
      dietary: rsvp.dietary,
      dietaryNotes: rsvp.dietaryNotes,
      drinkPreference: rsvp.drinkPreference,
      songRequest: rsvp.songRequest,
      message: rsvp.message,
    };
  }
  private async loadAnswerableInvitation(eventId: string, guestId: string) {
    const guest = await this.prisma.guest.findFirst({
      where: { id: guestId, eventId },
      select: {
        anonymizedAt: true,
        event: {
          select: {
            invitation: {
              select: {
                rsvpFields: true,
                questions: { select: { id: true, type: true, required: true, options: true } },
              },
            },
          },
        },
      },
    });
    if (!guest) throw new NotFoundException(`No guest ${guestId} on this event`);
    if (guest.anonymizedAt) throw new BadRequestException("This guest's details were erased at their request");

    return guest.event.invitation;
  }

}
