import { Prisma, QuestionType } from '@prisma/client';
import { booleanLabels } from '../rsvp/answer-display';

interface OptionCount { questionId: string; value: Prisma.JsonValue; attending: bigint; total: bigint }
type Counts = Map<string, Map<string, { attending: number; total: number }>>;

/** Expand multi-choice values before counting, rather than loading every answer. */
export async function readOptionCounts(tx: Prisma.TransactionClient, eventId: string, questionIds: string[]): Promise<Counts> {
  const counts: Counts = new Map();
  if (!questionIds.length) return counts;
  const rows = await tx.$queryRaw<OptionCount[]>`
    SELECT a."questionId", choice.value,
      count(*) FILTER (WHERE r.status = 'ATTENDING') AS attending, count(*) AS total
    FROM rsvp_answers a JOIN rsvp_questions q ON q.id = a."questionId"
      JOIN rsvps r ON r.id = a."rsvpId" JOIN guests g ON g.id = r."guestId"
      CROSS JOIN LATERAL jsonb_array_elements(CASE
        WHEN q.type = 'MULTI_CHOICE' AND jsonb_typeof(a.value) = 'array' THEN a.value
        WHEN q.type IN ('SINGLE_CHOICE', 'BOOLEAN') THEN jsonb_build_array(a.value)
        ELSE '[]'::jsonb END) choice(value)
    WHERE g."eventId" = ${eventId} AND g."anonymizedAt" IS NULL AND a."questionId" IN (${Prisma.join(questionIds)})
    GROUP BY a."questionId", choice.value`;
  for (const row of rows) {
    const question = counts.get(row.questionId) ?? new Map<string, { attending: number; total: number }>();
    question.set(JSON.stringify(row.value), { attending: Number(row.attending), total: Number(row.total) });
    counts.set(row.questionId, question);
  }
  return counts;
}

export function reportTally(question: { id: string; type: QuestionType }, labels: string[], counts: Counts, locale: string) {
  if (!['BOOLEAN', 'SINGLE_CHOICE', 'MULTI_CHOICE'].includes(question.type)) return null;
  const options = question.type === 'BOOLEAN' ? booleanLabels(locale) : labels;
  return options.map((option, index) => {
    const value = question.type === 'BOOLEAN' ? index === 0 : index;
    return { option, ...(counts.get(question.id)?.get(JSON.stringify(value)) ?? { attending: 0, total: 0 }) };
  });
}
