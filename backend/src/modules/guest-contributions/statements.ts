import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export async function versionStatement(tx: Prisma.TransactionClient, question: { id: string; type: string; prompt: Prisma.JsonValue; statementVersionId?: string | null }) {
  if (question.type !== 'SIGNATURE') {
    if (question.statementVersionId) await tx.rsvpQuestion.update({ where: { id: question.id }, data: { statementVersionId: null } });
    return null;
  }
  const current = question.statementVersionId ? await tx.questionStatement.findUnique({ where: { id: question.statementVersionId } }) : null;
  if (current && JSON.stringify(current.prompt) === JSON.stringify(question.prompt)) return current.id;
  assertStatementPrompt(question.prompt);
  const history = await tx.questionStatement.aggregate({ where: { questionId: question.id }, _max: { revision: true } });
  const version = await tx.questionStatement.create({ data: { questionId: question.id, revision: (history._max.revision ?? 0) + 1, prompt: question.prompt as Prisma.InputJsonValue } });
  await tx.rsvpQuestion.update({ where: { id: question.id }, data: { statementVersionId: version.id } });
  return version.id;
}
function assertStatementPrompt(prompt: Prisma.JsonValue): void {
  if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt)) throw new BadRequestException('prompt: signature statements need translated text');
  const hasInvalidText = Object.values(prompt).some((text) => typeof text !== 'string' || !text.trim() || text.length > 8000 || text.includes(String.fromCharCode(0)));
  if (hasInvalidText) throw new BadRequestException('prompt: each signature statement must be text of 1–8000 characters');
}
