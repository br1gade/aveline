import { Prisma } from '@prisma/client';

/** Roster answers must survive until settlement; JSON snapshots have no foreign-key lock. */
export async function lockCheckoutQuestions(tx: Prisma.TransactionClient, eventId: string) {
  await tx.$queryRaw`SELECT id FROM invitations WHERE "eventId" = ${eventId} FOR SHARE`;
  await tx.$queryRaw`SELECT q.id FROM rsvp_questions q JOIN invitations i ON i.id = q."invitationId"
    WHERE i."eventId" = ${eventId} ORDER BY q.id FOR SHARE OF q`;
}

/** Count each live answer or archived/pending checkout person once, without N+1 per roster. */
export async function countQuestionAnswers(tx: Prisma.TransactionClient, questionId: string) {
  const [row] = await tx.$queryRaw<{ count: bigint }[]>`
    SELECT (SELECT count(*) FROM rsvp_answers WHERE "questionId" = ${questionId}) +
      (SELECT count(*) FROM order_attendees a JOIN invitations i ON i."eventId" = a."eventId"
       JOIN rsvp_questions q ON q."invitationId" = i.id AND q.id = ${questionId}
       WHERE (a.answers @> ${JSON.stringify([{ questionId }])}::jsonb
         OR a."linkedSourceSnapshot" #> '{rsvp,answers}' @> ${JSON.stringify([{ questionId }])}::jsonb)
       AND NOT EXISTS (SELECT 1 FROM tickets t JOIN rsvps r ON r."guestId" = t."guestId"
         JOIN rsvp_answers answer ON answer."rsvpId" = r.id AND answer."questionId" = q.id
         WHERE t."attendeeId" = a.id)) AS count`;
  return Number(row.count);
}
