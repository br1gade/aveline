import { saveSignatureAnswer } from '../guest-contributions/acknowledgement-writes';
import { BadRequestException } from '@nestjs/common';
import { Prisma, Rsvp, RsvpStatus } from '@prisma/client';
import { REMINDER_TEMPLATE_KEY } from '../invitations/sending/reminder-schedule';
import { releaseSeat } from '../seating/released-seat';
import { AttendanceWrite, writeAttendance } from './attendance/attendance-writes';
import { Answer } from './answers';

/**
 * Writing one person's answer — shared by the guest's own form and the host
 * recording an answer phoned in, so the two cannot disagree about what an
 * edit keeps.
 */
export type Tx = Prisma.TransactionClient;

/** What one RSVP row may be told. Omitted fields keep their value. */
export type RsvpFields = Partial<
  Pick<Prisma.RsvpUncheckedCreateInput, 'dietary' | 'dietaryNotes' | 'drinkPreference' | 'songRequest' | 'message'>
> & { status: RsvpStatus };

/**
 * Writes one person's answer. Omitted fields keep their value, and the time
 * of the first answer is kept: an edit is not a new response, and the
 * response-rate trend reads when people first answered.
 */
export async function recordAnswer(tx: Tx, guestId: string, fields: RsvpFields, attendance?: AttendanceWrite) {
  if (fields.status === 'ATTENDING' && await tx.ticket.count({ where: { guestId, status: { in: ['VOID', 'REFUNDED'] } } })) {
    throw new BadRequestException('Ticket is no longer valid; attendance cannot be reconfirmed');
  }
  const rsvp = await saveResponse(tx, guestId, fields, attendance);
  let answered = rsvp;
  // A guest who is not coming should not hold a chair someone else could use.
  if (attendance) answered = await writeAttendance(tx, guestId, fields.status, attendance);
  else if (fields.status === RsvpStatus.DECLINED) await releaseSeat(tx, guestId);
  if (fields.status !== RsvpStatus.PENDING) await withdrawReminders(tx, guestId);
  return answered;
}

async function saveResponse(tx: Tx, guestId: string, fields: RsvpFields, attendance?: AttendanceWrite) {
  const existing = await tx.rsvp.findUnique({ where: { guestId } });
  if (existing && !hasResponseChanges(existing, fields, attendance)) return existing;
  const respondedAt = existing?.respondedAt ?? new Date();
  return tx.rsvp.upsert({ where: { guestId }, create: { guestId, ...fields, respondedAt }, update: { ...fields, respondedAt } });
}

function hasResponseChanges(existing: Rsvp, fields: RsvpFields, attendance?: AttendanceWrite): boolean {
  // Per-venue time is derived from attendance history, which deliberately
  // retains unknown imported timestamps. Never repeatedly invent an aggregate
  // time that refresh_venue_attendance immediately restores to null.
  if (!existing.respondedAt && attendance?.policy.attendanceMode !== 'PER_VENUE') return true;
  return Object.entries(fields).some(([key, value]) =>
    value !== undefined && JSON.stringify(existing[key as keyof Rsvp]) !== JSON.stringify(value));
}

/**
 * Withdraws reminders to answer still waiting in the outbox — retrying, or
 * not yet due — for a household that has now answered. One used to go out
 * after the answer, asking them to do what they had just done. The outbox
 * claims only QUEUED messages, so a withdrawn one can never be sent.
 */
async function withdrawReminders(tx: Tx, guestId: string): Promise<void> {
  await tx.$executeRaw`UPDATE messages m SET status = 'CANCELLED'::"MessageStatus",
    "failureReason" = 'The household answered before it was sent', "updatedAt" = statement_timestamp()
    FROM guests respondent, guests recipient WHERE respondent.id = ${guestId}
      AND recipient."householdId" = respondent."householdId" AND m."guestId" = recipient.id
      AND m."templateKey" = ${REMINDER_TEMPLATE_KEY} AND m.status = 'QUEUED'::"MessageStatus"`;
}

export async function saveAnswers(tx: Tx, rsvpId: string, answers: Answer[], signerGuestId?: string): Promise<void> {
  if (!answers.length) return;
  const signatures = new Set((await tx.rsvpQuestion.findMany({ where: { id: { in: answers.map((answer) => answer.questionId) }, type: 'SIGNATURE' }, select: { id: true } })).map((question) => question.id));
  for (const answer of answers) {
    const value = signatures.has(answer.questionId)
      ? await saveSignatureAnswer(tx, rsvpId, answer, signerGuestId)
      : answer.value as Prisma.InputJsonValue;
    await tx.rsvpAnswer.upsert({
      where: { rsvpId_questionId: { rsvpId, questionId: answer.questionId } },
      create: { rsvpId, questionId: answer.questionId, value },
      update: { value },
    });
  }
}

export function withoutUndefined<T extends object>(fields: T): T {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as T;
}

