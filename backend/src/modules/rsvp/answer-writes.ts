import { MessageStatus, Prisma, RsvpStatus } from '@prisma/client';
import { REMINDER_TEMPLATE_KEY } from '../invitations/sending/reminder-schedule';
import { releaseSeat } from '../seating/released-seat';
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
export async function recordAnswer(tx: Tx, guestId: string, fields: RsvpFields) {
  const existing = await tx.rsvp.findUnique({ where: { guestId }, select: { respondedAt: true } });
  const respondedAt = existing?.respondedAt ?? new Date();

  const rsvp = await tx.rsvp.upsert({
    where: { guestId },
    create: { guestId, ...fields, respondedAt },
    update: { ...fields, respondedAt },
  });
  // A guest who is not coming should not hold a chair someone else could use.
  if (fields.status === RsvpStatus.DECLINED) await releaseSeat(tx, guestId);
  if (fields.status !== RsvpStatus.PENDING) await withdrawReminders(tx, guestId);
  return rsvp;
}

/**
 * Withdraws reminders to answer still waiting in the outbox — retrying, or
 * not yet due — for a household that has now answered. One used to go out
 * after the answer, asking them to do what they had just done. The outbox
 * claims only QUEUED messages, so a withdrawn one can never be sent.
 */
async function withdrawReminders(tx: Tx, guestId: string): Promise<void> {
  const guest = await tx.guest.findUnique({ where: { id: guestId }, select: { householdId: true } });
  if (!guest) return;
  await tx.message.updateMany({
    where: { templateKey: REMINDER_TEMPLATE_KEY, status: MessageStatus.QUEUED, guest: { householdId: guest.householdId } },
    data: { status: MessageStatus.CANCELLED, failureReason: 'The household answered before it was sent' },
  });
}

export async function saveAnswers(tx: Tx, rsvpId: string, answers: Answer[]): Promise<void> {
  for (const answer of answers) {
    const value = answer.value as Prisma.InputJsonValue;
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

