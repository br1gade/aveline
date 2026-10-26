import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PlatformRole, Prisma } from '@prisma/client';

export interface LiveStaff {
  id: string;
  platformRole: PlatformRole;
  isActive: boolean;
  deletedAt: Date | null;
}

export function canAccessEnquiry(actor: LiveStaff, assignedUserId: string | null): boolean {
  return actor.isActive && !actor.deletedAt && (actor.platformRole === PlatformRole.ADMIN ||
    (actor.platformRole === PlatformRole.SUPPORT && actor.id === assignedUserId));
}

export async function lockStaff(tx: Prisma.TransactionClient, userId: string): Promise<LiveStaff> {
  const rows = await tx.$queryRaw<LiveStaff[]>`SELECT id, "platformRole", "isActive", "deletedAt" FROM users WHERE id = ${userId} FOR SHARE`;
  const actor = rows[0];
  if (!actor?.isActive || actor.deletedAt || actor.platformRole === PlatformRole.NONE) throw new ForbiddenException('Staff access required');
  return actor;
}

export function assertEnquiryAccess(actor: LiveStaff, assignedUserId: string | null): void {
  if (!canAccessEnquiry(actor, assignedUserId)) throw new NotFoundException('No such enquiry');
}

export async function lockOperators(tx: Prisma.TransactionClient, ids: string[]): Promise<LiveStaff[]> {
  const rows = await tx.$queryRaw<LiveStaff[]>`SELECT id, "platformRole", "isActive", "deletedAt" FROM users WHERE id IN (${Prisma.join([...new Set(ids)].sort())}) ORDER BY id FOR SHARE`;
  if (rows.length !== new Set(ids).size || rows.some((row) => !row.isActive || row.deletedAt || row.platformRole === 'NONE')) {
    throw new ForbiddenException('Operator must be active platform staff');
  }
  return rows;
}
