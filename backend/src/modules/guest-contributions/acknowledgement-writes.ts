import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { webcrypto } from 'node:crypto';
import { negotiateLocale, resolveTranslation } from '../../common/locale';
import { SignatureAnswer, signatureAnswerProblem } from './acknowledgement-rules';

export async function writeAcknowledgement(tx: Prisma.TransactionClient, subjectGuestId: string, value: unknown, signerGuestId: string) {
  const problem = signatureAnswerProblem(value);
  if (problem) throw new BadRequestException(`answers: ${problem}`);
  const answer = value as SignatureAnswer;
  const version = await requireCurrentStatement(tx, answer.statementVersionId);
  const { signer } = await requireParticipants(tx, { subjectGuestId, signerGuestId }, version.question.invitation.eventId);
  if (subjectGuestId !== signerGuestId && answer.isRepresentative !== true) throw new BadRequestException('isRepresentative: explicitly declare representation for another household member');
  if (!signer.event.locales.includes(answer.locale)) throw new BadRequestException('locale: use a published event language');
  const requested = negotiateLocale(answer.locale, signer.event.locales, signer.event.defaultLocale);
  const translations = version.prompt as Record<string, unknown>;
  const locale = [requested, signer.event.defaultLocale, ...Object.keys(translations)].find((language) => translations[language] !== undefined)!;
  const statement = resolveTranslation<string>(version.prompt, locale, signer.event.defaultLocale);
  if (typeof statement !== 'string') throw new BadRequestException('statement: no text is available');
  await assertSignatureAsset(tx, answer, signer);
  const data = { eventId: signer.eventId, questionId: version.questionId, statementVersionId: version.id, subjectGuestId, signerGuestId,
    signerName: answer.signerName.trim(), method: answer.method, isRepresentative: subjectGuestId !== signerGuestId, locale, statement, mediaId: answer.assetId ?? null };
  const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(data)));
  const dedupeKey = Buffer.from(digest).toString('hex');
  return tx.guestAcknowledgement.upsert({ where: { dedupeKey }, create: { ...data, dedupeKey }, update: {} });
}
async function requireCurrentStatement(tx: Prisma.TransactionClient, versionId: string) {
  const version = await tx.questionStatement.findUnique({ where: { id: versionId }, include: { question: { select: { invitation: { select: { eventId: true } } } } } });
  if (!version) throw new BadRequestException('statementVersionId: unknown statement');
  await tx.$queryRaw`SELECT id FROM rsvp_questions WHERE id = ${version.questionId} FOR SHARE`;
  const question = await tx.rsvpQuestion.findUniqueOrThrow({ where: { id: version.questionId }, select: { type: true, statementVersionId: true } });
  if (question.type !== 'SIGNATURE' || question.statementVersionId !== version.id) throw new ConflictException('statementVersionId: wording changed; read and acknowledge the current statement');
  return version;
}
async function requireParticipants(tx: Prisma.TransactionClient, ids: { subjectGuestId: string; signerGuestId: string }, eventId: string) {
  const people = await tx.guest.findMany({ where: { id: { in: [ids.subjectGuestId, ids.signerGuestId] }, eventId, anonymizedAt: null },
    select: { id: true, eventId: true, householdId: true, event: { select: { locales: true, defaultLocale: true } } } });
  const signer = people.find((person) => person.id === ids.signerGuestId);
  const subject = people.find((person) => person.id === ids.subjectGuestId);
  if (!signer || !subject || subject.householdId !== signer.householdId) throw new BadRequestException('subjectGuestIds: only current members of your own household may be acknowledged');
  return { signer, subject };
}

async function assertSignatureAsset(tx: Prisma.TransactionClient, answer: SignatureAnswer, signer: { id: string; eventId: string }) {
  if (answer.method !== 'DRAWN') return;
  await tx.$queryRaw`SELECT id FROM guest_media WHERE id = ${answer.assetId!} FOR SHARE`;
  const media = await tx.guestMedia.findFirst({ where: { id: answer.assetId, uploaderGuestId: signer.id, eventId: signer.eventId, kind: 'SIGNATURE', processingStatus: 'READY' }, select: { id: true } });
  if (!media) throw new BadRequestException('assetId: use your own processed signature upload from this event');
}

/** Stored answers refer to immutable records, never to a client-supplied image URL. */
export async function saveSignatureAnswer(tx: Prisma.TransactionClient, rsvpId: string, answer: { questionId: string; value: unknown }, signerGuestId?: string) {
  if (!signerGuestId) throw new BadRequestException('answers: acknowledgements require the actual signer’s personal link');
  const rsvp = await tx.rsvp.findUniqueOrThrow({ where: { id: rsvpId }, select: { guestId: true } });
  const record = await writeAcknowledgement(tx, rsvp.guestId, answer.value, signerGuestId);
  if (record.questionId !== answer.questionId) throw new BadRequestException('answers: the statement belongs to another question');
  return { acknowledgementId: record.id, statementVersionId: record.statementVersionId };
}

export async function assertRequiredAcknowledgements(tx: Prisma.TransactionClient, eventId: string, guestIds: string[]) {
  if (!guestIds.length) return;
  const signatures = await tx.$queryRaw<{ id: string }[]>`SELECT q.id FROM rsvp_questions q JOIN invitations i ON i.id = q."invitationId"
    WHERE i."eventId" = ${eventId} AND q.type = 'SIGNATURE' ORDER BY q.id FOR SHARE OF q`;
  if (!signatures.length) return;
  const missing = await tx.$queryRaw<{ questionId: string; guestId: string }[]>`
    SELECT q.id AS "questionId", g.id AS "guestId" FROM guests g
    JOIN invitations i ON i."eventId" = g."eventId" JOIN rsvp_questions q ON q."invitationId" = i.id
    WHERE g.id IN (${Prisma.join(guestIds)}) AND g."eventId" = ${eventId} AND q.type = 'SIGNATURE' AND q.required
      AND NOT EXISTS (SELECT 1 FROM guest_acknowledgements a LEFT JOIN guest_media m ON m.id = a."mediaId"
        WHERE a."subjectGuestId" = g.id AND a."statementVersionId" = q."statementVersionId"
          AND (a.method = 'TYPED' OR m."processingStatus" = 'READY')) LIMIT 1`;
  if (missing.length) throw new BadRequestException(`acknowledgements: ${missing[0].guestId} must acknowledge ${missing[0].questionId} in its current version`);
}
