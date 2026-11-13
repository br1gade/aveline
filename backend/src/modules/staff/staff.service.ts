import { ForbiddenException, Injectable } from '@nestjs/common';
import { PlatformRole, Prisma, StaffRoleChangeSource } from '@prisma/client';
import { DomainHttpException } from '../../common/domain-http.exception';
import { USED_EMAIL_VERIFICATION } from '../../infra/auth/verified-email';
import { PrismaService } from '../../prisma/prisma.service';
import { can } from '../access/access-policy';
import { STAFF_ROLES, StaffRole } from './dto/staff.dto';

/** Staff are a handful of people; the list is bounded rather than paged. */
const STAFF_LIST_LIMIT = 200;

const STAFF_MEMBER_SELECT = { id: true, email: true, name: true, platformRole: true } as const;

export interface StaffMember {
  userId: string;
  email: string;
  name: string;
  role: StaffRole;
}

const asStaffMember = (user: { id: string; email: string; name: string; platformRole: PlatformRole }): StaffMember =>
  ({ userId: user.id, email: user.email, name: user.name, role: user.platformRole as StaffRole });

/** Who can hold a role: an active account, not erased. */
const ACTIVE_ACCOUNT = { isActive: true, deletedAt: null } as const;

const SUBJECT_SELECT = {
  ...STAFF_MEMBER_SELECT,
  verificationTokens: { where: USED_EMAIL_VERIFICATION, take: 1, select: { id: true } },
} satisfies Prisma.UserSelect;

type Subject = Prisma.UserGetPayload<{ select: typeof SUBJECT_SELECT }>;

/** `actorUserId` is the admin acting through the API, or null for the ops command on the host. */
type Actor = string | null;

/**
 * Makes and removes Aveline staff.
 *
 * Each change is one transaction that locks the acting admin's row and the
 * subject's, re-reads the admin's role, and records the change in
 * `staff_role_changes`. Without the lock, two admins revoking each other at
 * once both passed the guard and left no admin. The role is read from the
 * database on every request (`AuthGuard`), so a change applies to the
 * account's next request without ending its session.
 */
@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<{ items: StaffMember[] }> {
    const users = await this.prisma.user.findMany({
      where: { ...ACTIVE_ACCOUNT, platformRole: { in: [...STAFF_ROLES] } },
      select: STAFF_MEMBER_SELECT,
      orderBy: { email: 'asc' },
      take: STAFF_LIST_LIMIT,
    });
    return { items: users.map(asStaffMember) };
  }

  /**
   * Gives a registered, verified account a staff role, or changes it.
   * Idempotent. Verified, because staff can erase people's data: an address
   * nobody proved owning must not become one.
   */
  grant(email: string, role: StaffRole, actorUserId: Actor): Promise<StaffMember> {
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.user.findFirst({ where: { ...ACTIVE_ACCOUNT, email }, select: { id: true } });
      if (!found) throw accountNotFound('email');
      assertNotSelf(found.id, actorUserId, 'email');
      const subject = await lockSubject(tx, found.id, actorUserId);
      if (!subject) throw accountNotFound('email');
      if (!subject.verificationTokens.length) throw new DomainHttpException('STAFF_EMAIL_UNVERIFIED', 'email: this account has not verified its address');
      return asStaffMember(await changeRole(tx, subject, role, actorUserId));
    });
  }

  /** Returns a staff account to an ordinary one. Idempotent: an account that is not staff is left as it is. */
  revoke(userId: string, actorUserId: Actor): Promise<void> {
    assertNotSelf(userId, actorUserId, 'userId');
    return this.prisma.$transaction(async (tx) => {
      const subject = await lockSubject(tx, userId, actorUserId);
      if (!subject) throw accountNotFound('userId');
      await changeRole(tx, subject, PlatformRole.NONE, actorUserId);
    });
  }
}

/**
 * Locks the subject's and the acting admin's rows in id order, then checks the
 * admin still may manage staff and reads the subject as it now stands.
 */
async function lockSubject(tx: Prisma.TransactionClient, subjectId: string, actorUserId: Actor): Promise<Subject | null> {
  const ids = [subjectId, ...(actorUserId ? [actorUserId] : [])].sort();
  await tx.$queryRaw`SELECT id FROM users WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
  if (actorUserId) await requireCurrentAdmin(tx, actorUserId);
  return tx.user.findFirst({ where: { id: subjectId, ...ACTIVE_ACCOUNT }, select: SUBJECT_SELECT });
}

async function requireCurrentAdmin(tx: Prisma.TransactionClient, actorUserId: string): Promise<void> {
  const actor = await tx.user.findFirst({ where: { id: actorUserId, ...ACTIVE_ACCOUNT }, select: { platformRole: true } });
  if (!actor || !can({ kind: 'staff', role: actor.platformRole }, 'staff:manage')) throw new ForbiddenException('Your role no longer manages staff');
}

/** Writes the role and its record together; a change to the same role writes neither. */
async function changeRole(tx: Prisma.TransactionClient, subject: Subject, role: PlatformRole, actorUserId: Actor) {
  if (subject.platformRole === role) return subject;
  await tx.staffRoleChange.create({
    data: {
      actorUserId,
      subjectUserId: subject.id,
      previousRole: subject.platformRole,
      role,
      source: actorUserId ? StaffRoleChangeSource.API : StaffRoleChangeSource.OPS,
    },
  });
  return tx.user.update({ where: { id: subject.id }, data: { platformRole: role }, select: STAFF_MEMBER_SELECT });
}

export const accountNotFound = (field: 'email' | 'userId') =>
  new DomainHttpException('STAFF_ACCOUNT_NOT_FOUND', `${field}: no active account matches`);

/** An admin changing their own role could lock the platform out of its last admin by a slip. */
function assertNotSelf(userId: string, actorUserId: Actor, field: 'email' | 'userId'): void {
  if (userId === actorUserId) throw new DomainHttpException('STAFF_SELF_CHANGE', `${field}: ask another administrator to change your own role`);
}
