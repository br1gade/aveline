import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface OrganizationCursor { createdAt: Date; id: string }
export function parseOrganizationCursor(cursor?: string): OrganizationCursor | undefined {
  if (!cursor) return undefined;
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!value || typeof value !== 'object' || !('id' in value) || !('createdAt' in value)) throw new Error();
    const { id, createdAt } = value;
    if (!isCursorId(id) || typeof createdAt !== 'string') throw new Error();
    const date = new Date(createdAt);
    if (!Number.isFinite(date.getTime())) throw new Error();
    return { id, createdAt: date };
  } catch { throw new BadRequestException('cursor: must be a valid organization cursor'); }
}
export function organizationCursorWhere(cursor?: OrganizationCursor): Prisma.OrganizationMembershipWhereInput {
  return cursor ? { OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] } : {};
}
export function pageOf<T extends { id: string; createdAt: Date }>(rows: T[], limit: number) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({ id: last.id, createdAt: last.createdAt.toISOString() })).toString('base64url') : null };
}

function isCursorId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}
