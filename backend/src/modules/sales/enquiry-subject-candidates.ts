import { BadRequestException } from '@nestjs/common';
import { EnquiryAddressKind, Prisma } from '@prisma/client';

export interface SubjectCandidateQuery { fingerprint: string; kind: EnquiryAddressKind; limit?: number; cursor?: string }

export async function findSubjectCandidates(tx: Pick<Prisma.TransactionClient, 'enquiryContact'>, input: SubjectCandidateQuery) {
  const limit = input.limit ?? 50;
  const after = decodeCandidateCursor(input);
  const rows = await tx.enquiryContact.findMany({ where: { ...(after ? { id: { gt: after } } : {}), addresses: { some: { kind: input.kind, fingerprint: input.fingerprint } } }, select: { id: true, enquiryId: true, name: true, email: true, phone: true, redactedAt: true }, orderBy: { id: 'asc' }, take: limit + 1 });
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  const nextCursor = rows.length > limit && last ? Buffer.from(JSON.stringify({ id: last.id, fingerprint: input.fingerprint, kind: input.kind })).toString('base64url') : null;
  return { items, nextCursor };
}

function decodeCandidateCursor(input: SubjectCandidateQuery): string | null {
  if (!input.cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(input.cursor, 'base64url').toString()) as { id: string; fingerprint: string; kind: string };
    if (typeof value.id !== 'string' || value.id.length > 128 || value.fingerprint !== input.fingerprint || value.kind !== input.kind) throw new Error();
    return value.id;
  } catch { throw new BadRequestException('cursor is invalid for these subject candidate filters'); }
}
