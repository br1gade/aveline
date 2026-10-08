import { Prisma, RsvpStatus } from '@prisma/client';
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

  return tx.rsvp.upsert({
    where: { guestId },
    create: { guestId, ...fields, respondedAt },
    update: { ...fields, respondedAt },
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

